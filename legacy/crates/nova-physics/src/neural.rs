//! Neural organisms with stable-ID working memory and a bounded nutrient pool.
use anyhow::{ensure, Result};
use nova_core::{delta, norm, recurrent::Memory, Lineage, Particles, SplitMix64};
use nova_spatial::CellList;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct NeuralConfig {
    pub sensing_radius: f32,
    pub impulse: f32,
    pub basal_cost: u32,
    pub motor_cost: u32,
    pub nutrient_per_tick: u32,
    pub max_energy: u32,
    pub reproduction_energy: u32,
    pub min_age: u64,
    pub birth_budget: usize,
}
impl Default for NeuralConfig {
    fn default() -> Self {
        Self {
            sensing_radius: 0.8,
            impulse: 0.25,
            basal_cost: 1,
            motor_cost: 4,
            nutrient_per_tick: 512,
            max_energy: 10000,
            reproduction_energy: 1000,
            min_age: 32,
            birth_budget: 64,
        }
    }
}
impl NeuralConfig {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.sensing_radius.is_finite()
                && self.sensing_radius > 0.
                && self.impulse.is_finite()
                && (0.0..=10.).contains(&self.impulse),
            "invalid neural physics"
        );
        ensure!(
            self.max_energy > 0
                && self.max_energy <= 1_000_000
                && self.reproduction_energy >= 2
                && self.reproduction_energy <= self.max_energy
                && self.birth_budget <= 4096
                && self.nutrient_per_tick <= 10_000_000,
            "invalid metabolic budget"
        );
        Ok(())
    }
}
#[derive(Default, Clone, Serialize, Deserialize)]
pub struct NeuralStats {
    pub born: u64,
    pub died: u64,
    pub consumed: u64,
    pub dissipated: u64,
    pub living: usize,
}
pub struct NeuralPopulation {
    pub config: NeuralConfig,
    pub memory: BTreeMap<u64, Memory>,
    pub stats: NeuralStats,
    rng: SplitMix64,
}
impl NeuralPopulation {
    pub fn new(config: NeuralConfig, seed: u64) -> Result<Self> {
        config.validate()?;
        Ok(Self {
            config,
            memory: BTreeMap::new(),
            stats: Default::default(),
            rng: SplitMix64(seed),
        })
    }
    pub fn step(
        &mut self,
        p: &mut Particles,
        dt: f32,
        tick: u64,
        capacity: usize,
        domain: Option<&nova_fusion::Settings>,
    ) -> Result<()> {
        self.config.validate()?;
        ensure!(dt.is_finite() && dt > 0., "invalid neural dt");
        if p.is_empty() {
            return Ok(());
        }
        let c = &self.config;
        let width = c
            .sensing_radius
            .max(p.positions.iter().map(|x| 2. * x.0[3]).fold(0., f32::max));
        let periodic = domain.filter(|s| s.boundary == nova_fusion::Boundary::Wrap);
        let open = if periodic.is_none() {
            Some(CellList::rebuild(p, width)?)
        } else {
            None
        };
        let wrapped = periodic
            .map(|s| {
                let mut s = s.clone();
                s.max_radius = [[width; 8]; 8];
                nova_fusion::grid::Grid::build(p, &s)
            })
            .transpose()?;
        let cells = Neighborhood { open, wrapped };
        let displacement = |a, b| {
            domain
                .map(|s| s.displacement(a, b))
                .unwrap_or_else(|| delta(a, b))
        };
        let mut outputs = Vec::with_capacity(p.len());
        let mut grant_left = c.nutrient_per_tick;
        // Rotate allocation order to avoid perpetual preference for low Morton keys.
        let start = self.rng.next_u64() as usize % p.len();
        let mut grants = vec![0; p.len()];
        for offset in 0..p.len() {
            let i = (start + offset) % p.len();
            let pos = p.positions[i].0;
            let resource = (0.5 + 0.5 * (pos[0] * 0.2 + tick as f32 * 0.002).sin())
                * (0.5 + 0.5 * (pos[1] * 0.3).cos());
            let grant = ((resource * 4.) as u32)
                .min(grant_left)
                .min(c.max_energy.saturating_sub(p.phenotypes[i][3]));
            grants[i] = grant;
            grant_left -= grant;
        }
        self.stats.consumed += (c.nutrient_per_tick - grant_left) as u64;
        for (i, &grant) in grants.iter().enumerate() {
            let pos = p.positions[i].0;
            let mut count = 0.;
            let mut flow = [0.; 3];
            let mut stress = 0.;
            for j in cells.candidates(pos) {
                if j == i {
                    continue;
                }
                let d = norm(displacement(pos, p.positions[j].0));
                if d < c.sensing_radius {
                    count += 1.;
                    for (k, f) in flow.iter_mut().enumerate() {
                        *f += p.velocities[j].0[k] - p.velocities[i].0[k]
                    }
                    stress += (1. - d / (pos[3] + p.positions[j].0[3])).max(0.);
                }
            }
            let memory = self.memory.entry(p.ids[i]).or_default();
            let h = memory.update(
                &p.genomes[i],
                [
                    count / (count + 8.),
                    (pos[0] * 0.2 + tick as f32 * 0.002).cos(),
                    flow[0] / (1. + count),
                    stress / (1. + stress),
                ],
            );
            let energy = p.phenotypes[i][3]
                .min(c.max_energy)
                .saturating_add(grant)
                .min(c.max_energy);
            let cost = c.basal_cost.saturating_add(
                (c.motor_cost as f32 * h[..3].iter().map(|x| x * x).sum::<f32>()) as u32,
            );
            let spent = energy.min(cost);
            self.stats.dissipated += spent as u64;
            outputs.push((h, energy - spent, memory.age));
        }
        let mut used = vec![false; p.len()];
        let mut children = Vec::new();
        for i in 0..p.len() {
            if used[i]
                || outputs[i].1 < c.reproduction_energy
                || outputs[i].2 < c.min_age
                || outputs[i].0[3] <= 0.
            {
                continue;
            }
            for j in cells.candidates(p.positions[i].0) {
                if j <= i
                    || used[j]
                    || outputs[j].1 < c.reproduction_energy
                    || outputs[j].2 < c.min_age
                    || outputs[j].0[3] <= 0.
                    || p.len() + children.len() >= capacity
                    || children.len() >= c.birth_budget
                {
                    continue;
                }
                let a = p.get(i);
                let b = p.get(j);
                if norm(displacement(a.pos_rad, b.pos_rad)) > a.pos_rad[3] + b.pos_rad[3]
                    || a.vel_mass[3].min(b.vel_mass[3]) < 1e-5
                {
                    continue;
                }
                let mut child = a;
                let cut = (self.rng.next_u64() % 15 + 1) as usize;
                child.genome_tape[cut..].copy_from_slice(&b.genome_tape[cut..]);
                for byte in &mut child.genome_tape {
                    if self.rng.unit() < 0.03125 {
                        *byte ^= 1 << (self.rng.next_u64() % 8)
                    }
                }
                let ma = a.vel_mass[3] * 0.25;
                let mb = b.vel_mass[3] * 0.25;
                child.vel_mass[3] = ma + mb;
                let separation = displacement(a.pos_rad, b.pos_rad);
                for k in 0..3 {
                    child.pos_rad[k] = a.pos_rad[k] + separation[k] * 0.5;
                    if let Some(s) = periodic {
                        if k < s.dimensions {
                            child.pos_rad[k] = (child.pos_rad[k] + s.half_extent[k])
                                .rem_euclid(2. * s.half_extent[k])
                                - s.half_extent[k];
                        }
                    }
                    child.vel_mass[k] = (ma * a.vel_mass[k] + mb * b.vel_mass[k]) / (ma + mb)
                }
                child.phenotype[3] = c.reproduction_energy; // Parents pay 2E, child receives E.
                let lineage = Lineage::new(
                    &child.genome_tape,
                    vec![p.lineages[i].hash.clone(), p.lineages[j].hash.clone()],
                    p.lineages[i]
                        .generation
                        .max(p.lineages[j].generation)
                        .saturating_add(1),
                    tick,
                );
                p.velocities[i].0[3] -= ma;
                p.velocities[j].0[3] -= mb;
                outputs[i].1 -= c.reproduction_energy;
                outputs[j].1 -= c.reproduction_energy;
                self.stats.dissipated += c.reproduction_energy as u64;
                used[i] = true;
                used[j] = true;
                children.push((child, lineage));
                break;
            }
        }
        for i in 0..p.len() {
            let (h, e, _) = outputs[i];
            p.phenotypes[i][3] = e;
            if e > 0 {
                for (k, &motor) in h
                    .iter()
                    .take(domain.map(|s| s.dimensions).unwrap_or(3))
                    .enumerate()
                {
                    p.velocities[i].0[k] += dt * c.impulse * motor / p.velocities[i].0[3]
                }
            }
        }
        let keep: Vec<_> = (0..p.len()).filter(|&i| p.phenotypes[i][3] > 0).collect();
        self.stats.died += (p.len() - keep.len()) as u64;
        p.reorder(&keep);
        for (child, lineage) in children {
            p.push(child, lineage)?;
            self.stats.born += 1;
        }
        let living: std::collections::BTreeSet<_> = p.ids.iter().copied().collect();
        self.memory.retain(|id, _| living.contains(id));
        self.stats.living = p.len();
        p.validate()
    }
}

struct Neighborhood {
    open: Option<CellList>,
    wrapped: Option<nova_fusion::grid::Grid>,
}
impl Neighborhood {
    fn candidates(&self, p: [f32; 4]) -> impl Iterator<Item = usize> + '_ {
        self.open
            .iter()
            .flat_map(move |g| g.candidates(p))
            .chain(self.wrapped.iter().flat_map(move |g| g.candidates(p)))
    }
}
