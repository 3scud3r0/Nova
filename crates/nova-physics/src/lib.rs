pub mod conway;
pub mod mpm;
use anyhow::{ensure, Result};
use nova_core::{delta, norm, Float4, Lineage, Particle, Particles, SplitMix64};
use nova_spatial::CellList;
use nova_vm::{crossover, execute};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub fusion: Option<nova_fusion::Family>,
    pub seed: u64,
    pub dt: f32,
    pub cutoff: f32,
    pub beta: f32,
    pub strength: f32,
    pub damping: f32,
    pub curl: f32,
    pub pvm: bool,
    pub crossover: bool,
    pub mpm: bool,
    pub max_particles: usize,
    pub crossover_speed: f32,
    pub mutation_temperature: f32,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            fusion: None,
            seed: 42,
            dt: 1. / 120.,
            cutoff: 0.35,
            beta: 0.25,
            strength: 4.,
            damping: 1.8,
            curl: 0.,
            pvm: false,
            crossover: false,
            mpm: false,
            max_particles: 262144,
            crossover_speed: 0.5,
            mutation_temperature: 0.05,
        }
    }
}
impl Config {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            [
                self.dt,
                self.cutoff,
                self.beta,
                self.strength,
                self.damping,
                self.curl,
                self.crossover_speed,
                self.mutation_temperature
            ]
            .iter()
            .all(|x| x.is_finite()),
            "nonfinite configuration"
        );
        ensure!(
            self.dt > 0.
                && self.dt <= if self.fusion.is_some() { 1. } else { 0.02 }
                && self.cutoff > 0.
                && self.beta > 0.
                && self.beta < 1.
                && self.damping >= 0.
                && self.strength >= 0.
                && self.crossover_speed >= 0.
                && self.max_particles > 0
                && self.max_particles <= 10_000_000,
            "invalid simulation configuration"
        );
        ensure!(
            (0.0..=1.).contains(&self.mutation_temperature),
            "invalid crossover probability"
        );
        ensure!(!self.crossover || self.pvm, "crossover requires PVM");
        ensure!(
            !self.mpm || (!self.pvm && self.curl == 0.),
            "MPM is an independent substrate"
        );
        ensure!(
            self.fusion.is_none() || (!self.pvm && !self.mpm && self.curl == 0.),
            "fusion is an independent substrate"
        );
        Ok(())
    }
}
/// Piecewise directed Particle Life force. No neighbor normalization or truncation.
pub fn radial(q: f32, affinity: f32, beta: f32) -> f32 {
    if q >= 1. {
        0.
    } else if q < beta {
        q / beta - 1.
    } else {
        affinity * (1. - (2. * q - 1. - beta).abs() / (1. - beta))
    }
}
/// Analytic curl of a smooth trigonometric vector potential, not simplex noise.
/// Divergence-free analytically; finite-step particle integration is not exactly volume preserving.
pub fn curl(p: [f32; 4], time: f32) -> [f32; 3] {
    let [x, y, z, _] = p;
    [
        (x + 0.7 * time).sin() * y.cos() - x.sin() * (z + 0.3 * time).cos(),
        (y + 0.9 * time).sin() * z.cos() - y.sin() * (x + 0.7 * time).cos(),
        (z + 0.3 * time).sin() * x.cos() - z.sin() * (y + 0.9 * time).cos(),
    ]
}
pub struct Universe {
    pub fusion: Option<nova_fusion::Model>,
    pub particles: Particles,
    pub config: Config,
    pub matrix: [[f32; 8]; 8],
    pub tick: u64,
    pub births: u64,
    pub injected: u64,
    pub metabolism: u64,
    rng: SplitMix64,
    material: Option<mpm::Mpm>,
}
impl Universe {
    pub fn new(count: usize, config: Config) -> Result<Self> {
        config.validate()?;
        ensure!(
            count > 0 && count <= config.max_particles,
            "particle count exceeds budget"
        );
        let mut rng = SplitMix64(config.seed);
        let mut matrix = [[0.; 8]; 8];
        for (i, row) in matrix.iter_mut().enumerate() {
            for (j, x) in row.iter_mut().enumerate() {
                *x = if i == j { 0.7 } else { rng.signed() };
            }
        }
        let mut u = Self {
            fusion: None,
            particles: Particles::default(),
            matrix,
            tick: 0,
            births: 0,
            injected: 0,
            metabolism: 0,
            rng,
            material: None,
            config,
        };
        u.emit(count)?;
        if let Some(family) = u.config.fusion {
            let mut model = nova_fusion::Model::new(family);
            model.initialize(&mut u.particles, &mut u.matrix, u.config.seed)?;
            u.config.dt = model.settings.dt;
            u.fusion = Some(model);
        }
        if u.config.mpm {
            for i in 0..count {
                for k in 0..3 {
                    u.particles.positions[i].0[k] = u.rng.signed() * 0.5;
                    u.particles.velocities[i].0[k] = 0.;
                }
                u.particles.velocities[i].0[3] = 1. / count as f32;
            }
            let mut material = mpm::Mpm::new(count);
            material.dt = u.config.dt;
            u.material = Some(material);
        }
        Ok(u)
    }
    /// Opposing moving emitters with a long initial jet, in open space.
    pub fn emit(&mut self, count: usize) -> Result<()> {
        ensure!(
            self.material.is_none() && self.fusion.is_none(),
            "MPM/fusion membership is fixed; reset the scene to change count"
        );
        ensure!(
            count <= self.config.max_particles - self.particles.len(),
            "emission exceeds particle budget"
        );
        let scale = (self.config.max_particles.min(65536) as f32 / 4096.).cbrt();
        for i in 0..count {
            let side = if i % 2 == 0 { 1. } else { -1. };
            let angle = self.rng.unit() * std::f32::consts::TAU;
            let radius = self.rng.unit().sqrt() * 0.65 * scale;
            let t = self.tick as f32 * self.config.dt;
            let p = Particle {
                pos_rad: [
                    side * (1. + self.rng.unit() * 7.) * scale,
                    radius * angle.cos() + 0.3 * t.sin(),
                    radius * angle.sin(),
                    0.05,
                ],
                vel_mass: [-side * 2., 0.15 * (t + angle).sin(), 0.15 * angle.cos(), 1.],
                phenotype: [(self.rng.next_u64() % 8) as u32, 0, 0, 10000],
                genome_tape: if self.config.pvm {
                    [
                        0x10, 0x2f, 0x34, 0x48, 0x50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    ]
                } else {
                    [0; 16]
                },
            };
            self.particles
                .push(p, Lineage::new(&p.genome_tape, vec![], 0, self.tick))?;
        }
        self.injected += count as u64;
        Ok(())
    }
    pub fn step(&mut self, steps: usize) -> Result<()> {
        ensure!(steps <= 1_000_000, "step request exceeds budget");
        self.config.validate()?;
        ensure!(
            self.matrix
                .iter()
                .flatten()
                .all(|x| x.is_finite() && x.abs() <= 1.),
            "affinity matrix must be finite in [-1,1]"
        );
        for _ in 0..steps {
            self.advance()?;
        }
        Ok(())
    }
    fn advance(&mut self) -> Result<()> {
        if let Some(model) = &mut self.fusion {
            model.settings.dt = self.config.dt;
            model.step(&mut self.particles, &self.matrix, self.tick)?;
            self.tick += 1;
            return Ok(());
        }
        if let Some(material) = &mut self.material {
            material.dt = self.config.dt;
            material.step(&mut self.particles)?;
            self.tick += 1;
            return Ok(());
        }
        let c = &self.config;
        let cells = CellList::rebuild(&mut self.particles, c.cutoff)?;
        let p = &self.particles;
        let outputs: Vec<_> = (0..p.len())
            .into_par_iter()
            .map(|i| {
                let xi = p.positions[i].0;
                let mut energy = p.phenotypes[i][3];
                let density = if c.pvm {
                    cells
                        .candidates(xi)
                        .filter(|&j| j != i && norm(delta(xi, p.positions[j].0)) < c.cutoff)
                        .count() as f32
                } else {
                    0.
                };
                let r = execute(
                    if c.pvm { &p.genomes[i] } else { &[0; 16] },
                    density,
                    &mut energy,
                    c.dt,
                );
                let mut force = [0.; 3];
                for j in cells.candidates(xi) {
                    if i == j {
                        continue;
                    }
                    let d = delta(xi, p.positions[j].0);
                    let distance = norm(d);
                    if distance >= c.cutoff {
                        continue;
                    }
                    // Coincident particles receive a deterministic anti-symmetric direction.
                    let direction = if distance < 1e-9 {
                        [if p.ids[i] < p.ids[j] { 1. } else { -1. }, 0., 0.]
                    } else {
                        d.map(|v| v / distance)
                    };
                    let affinity = self.matrix[p.phenotypes[i][0] as usize]
                        [p.phenotypes[j][0] as usize]
                        * r.affinity;
                    let f = c.strength * radial(distance / c.cutoff, affinity, c.beta);
                    for k in 0..3 {
                        force[k] += direction[k] * f;
                    }
                }
                let vortex = curl(xi, self.tick as f32 * c.dt);
                let mut v = p.velocities[i].0;
                let mut x = xi;
                for k in 0..3 {
                    v[k] = (v[k] + c.dt * (force[k] + c.curl * vortex[k]) / v[3])
                        * (-c.damping * (1. - r.drag_resistance) * c.dt).exp();
                    x[k] += c.dt * v[k];
                }
                (Float4(x), Float4(v), energy, r)
            })
            .collect();
        // Enzymatic transduction is a pair impulse; total pair momentum is preserved.
        let mut impulses = vec![[0f32; 3]; p.len()];
        if c.pvm {
            for i in 0..p.len() {
                for j in cells.candidates(p.positions[i].0) {
                    if j <= i {
                        continue;
                    }
                    let d = delta(p.positions[i].0, p.positions[j].0);
                    let distance = norm(d);
                    if distance > 1e-9 && distance < p.positions[i].0[3] + p.positions[j].0[3] {
                        let impulse = c.dt * (outputs[i].3.impulse + outputs[j].3.impulse);
                        for k in 0..3 {
                            let q = impulse * d[k] / distance;
                            impulses[i][k] -= q;
                            impulses[j][k] += q;
                        }
                    }
                }
            }
        }
        for (i, (x, mut v, energy, _)) in outputs.iter().copied().enumerate() {
            for k in 0..3 {
                v.0[k] += impulses[i][k] / v.0[3];
            }
            self.metabolism += (self.particles.phenotypes[i][3] - energy) as u64;
            self.particles.positions[i] = x;
            self.particles.velocities[i] = v;
            self.particles.phenotypes[i][3] = energy;
        }
        if self.config.crossover {
            let cells = CellList::rebuild(&mut self.particles, self.config.cutoff)?;
            let mut children = Vec::new();
            let mut used = vec![false; self.particles.len()];
            for i in 0..self.particles.len() {
                if used[i]
                    || self.particles.phenotypes[i][3] < 2000
                    || !self.particles.genomes[i].iter().any(|x| x >> 4 == 5)
                {
                    continue;
                }
                for j in cells.candidates(self.particles.positions[i].0) {
                    if j <= i
                        || used[j]
                        || self.particles.phenotypes[j][3] < 2000
                        || self.particles.len() + children.len() >= self.config.max_particles
                    {
                        continue;
                    }
                    let a = self.particles.get(i);
                    let b = self.particles.get(j);
                    if norm(delta(a.pos_rad, b.pos_rad)) >= a.pos_rad[3] + b.pos_rad[3]
                        || norm(delta(a.vel_mass, b.vel_mass)) < self.config.crossover_speed
                    {
                        continue;
                    }
                    if self.rng.unit() > self.config.mutation_temperature {
                        continue;
                    }
                    if a.vel_mass[3].min(b.vel_mass[3]) < 1e-5 {
                        continue;
                    }
                    let child = crossover(
                        &a,
                        &b,
                        &self.particles.lineages[i],
                        &self.particles.lineages[j],
                        self.tick,
                        &mut self.rng,
                    );
                    self.particles.velocities[i].0[3] *= 0.9;
                    self.particles.velocities[j].0[3] *= 0.9;
                    self.particles.phenotypes[i][3] -= 1000;
                    self.particles.phenotypes[j][3] -= 1000;
                    used[i] = true;
                    used[j] = true;
                    children.push(child);
                    break;
                }
            }
            self.births += children.len() as u64;
            for (p, l) in children {
                self.particles.push(p, l)?;
            }
        }
        self.particles.validate()?;
        self.tick += 1;
        Ok(())
    }
}

pub use nova_fusion::breeding::Candidate as FusionCandidate;
impl Universe {
    pub fn breed_rules(&self) -> Result<Vec<FusionCandidate>> {
        let m = self
            .fusion
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("fusion scene required"))?;
        let mate = nova_fusion::breeding::preset("symbiotes")?.matrix8()?;
        nova_fusion::breeding::breed(
            &self.matrix,
            &mate,
            m.settings.species,
            self.config
                .seed
                .wrapping_add(self.tick)
                .wrapping_add(m.rule_history.len() as u64),
            m.rule_history.last().map(|x| x.generation + 1).unwrap_or(1),
        )
    }
    pub fn choose_rules(&mut self, choice: &FusionCandidate) -> Result<()> {
        let m = self
            .fusion
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("fusion scene required"))?;
        ensure!(
            choice
                .matrix
                .iter()
                .flatten()
                .all(|x| x.is_finite() && x.abs() <= 1.),
            "invalid selected rules"
        );
        self.matrix = choice.matrix;
        m.rule_history.push(choice.lineage.clone());
        Ok(())
    }
}

pub fn fusion_family(name: &str) -> Result<nova_fusion::Family> {
    nova_fusion::Family::parse(name)
}
