pub mod forces;
use crate::*;
use nova_physics::{Config, Universe};
pub fn accepts_neural(kind: &str) -> bool {
    matches!(
        kind,
        "particle-life"
            | "fusion"
            | "hunar"
            | "realethersim"
            | "primordial-dish"
            | "par-particle-life"
            | "cellflow"
    )
}
pub struct ParticleSubstrate {
    pub universe: Universe,
    shape: [usize; 3],
    pub extent: [f32; 3],
    tensor: Vec<f32>,
}
pub fn build(s: &EnvironmentSpec) -> Result<Box<dyn Substrate>> {
    Ok(Box::new(ParticleSubstrate::new(s, false)?))
}
impl ParticleSubstrate {
    pub fn new(s: &EnvironmentSpec, mpm: bool) -> Result<Self> {
        let pvm = s.kind == "particle-vm";
        let fusion = if !mpm && !matches!(s.kind.as_str(), "particle-life" | "particle-vm") {
            Some(nova_fusion::Family::parse(&s.kind)?)
        } else {
            None
        };
        let mut universe = Universe::new(
            s.particles,
            Config {
                seed: s.seed,
                fusion,
                pvm,
                crossover: pvm,
                mpm,
                dt: if mpm { 0.001 } else { 1. / 120. },
                max_particles: s.particles.saturating_mul(4).min(262144),
                ..Default::default()
            },
        )?;
        if let Some(damping) = s.damping {
            universe.config.damping = damping;
            if let Some(model) = &mut universe.fusion {
                model.settings.retention = (-damping * model.settings.dt).exp();
            }
        }
        if let Some(strength) = s.strength {
            universe.config.strength = strength;
            if let Some(model) = &mut universe.fusion {
                model.settings.force = strength;
            }
        }
        if let Some(matrix) = s.matrix {
            universe.matrix = matrix;
        }
        if let Some(neural) = &s.neural {
            universe.enable_neural(neural.clone())?;
        }
        if let Some(tape) = s.genome {
            ensure!(
                s.neural.is_some() || pvm,
                "genome requires neural/PVM substrate"
            );
            for i in 0..universe.particles.len() {
                universe.particles.genomes[i] = tape;
                universe.particles.lineages[i] = nova_core::Lineage::new(&tape, vec![], 0, 0);
            }
        }
        let extent = universe
            .fusion
            .as_ref()
            .map(|f| f.settings.half_extent)
            .unwrap_or([16.; 3]);
        let mut a = Self {
            tensor: vec![0.; 4 * s.shape.iter().product::<usize>()],
            shape: s.shape,
            extent,
            universe,
        };
        a.refresh();
        Ok(a)
    }
    pub(crate) fn refresh(&mut self) {
        self.tensor.fill(0.);
        let n = self.tensor.len() / 4;
        for i in 0..self.universe.particles.len() {
            let p = self.universe.particles.positions[i].0;
            let mut c = [0; 3];
            let mut valid = true;
            for k in 0..3 {
                let q = (p[k] / (2. * self.extent[k]) + 0.5) * self.shape[k] as f32;
                if self.shape[k] == 1 {
                    c[k] = 0;
                } else if q < 0. || q >= self.shape[k] as f32 {
                    valid = false;
                    break;
                } else {
                    c[k] = q as usize;
                }
            }
            if !valid {
                continue;
            }
            let j = (c[2] * self.shape[1] + c[1]) * self.shape[0] + c[0];
            self.tensor[j] += 1.;
            self.tensor[n + j] += self.universe.particles.velocities[i].0[0];
            self.tensor[2 * n + j] += self.universe.particles.velocities[i].0[1];
            self.tensor[3 * n + j] += self.universe.particles.phenotypes[i][3] as f32 / 10000.;
        }
        for i in 0..n {
            let count = self.tensor[i];
            if count > 0. {
                for k in 1..4 {
                    self.tensor[k * n + i] /= count
                }
                self.tensor[i] = count / (count + 1.);
            }
        }
    }
}
impl Substrate for ParticleSubstrate {
    fn name(&self) -> &'static str {
        if self.universe.config.mpm {
            "mpm"
        } else if self.universe.config.pvm {
            "particle-vm"
        } else {
            match self.universe.config.fusion {
                Some(nova_fusion::Family::Fusion) => "fusion",
                Some(nova_fusion::Family::Hunar) => "hunar",
                Some(nova_fusion::Family::Realethersim) => "realethersim",
                Some(nova_fusion::Family::PrimordialDish) => "primordial-dish",
                Some(nova_fusion::Family::ParParticleLife) => "par-particle-life",
                Some(nova_fusion::Family::CellFlow) => "cellflow",
                None => "particle-life",
            }
        }
    }
    fn step(&mut self, ticks: usize) -> Result<()> {
        self.universe.step(ticks)?;
        self.refresh();
        Ok(())
    }
    fn observe(&self) -> TensorView<'_> {
        TensorView {
            shape: [4, self.shape[2], self.shape[1], self.shape[0]],
            values: &self.tensor,
            tick: self.universe.tick,
        }
    }
    fn interact(&mut self, a: &Action) -> Result<()> {
        a.validate()?;
        let (position, radius) = match a {
            Action::Paint {
                position, radius, ..
            }
            | Action::Impulse {
                position, radius, ..
            } => (*position, *radius),
        };
        let center = std::array::from_fn::<_, 3, _>(|k| (position[k] * 2. - 1.) * self.extent[k]);
        let r = radius * 2. * self.extent[0].min(self.extent[1]);
        for i in 0..self.universe.particles.len() {
            let d = std::array::from_fn::<_, 3, _>(|k| {
                center[k] - self.universe.particles.positions[i].0[k]
            });
            let dist = nova_core::norm(d);
            if dist < r {
                for k in 0..3 {
                    let impulse = match a {
                        Action::Paint { strength, .. } => strength * d[k] / dist.max(1e-4),
                        Action::Impulse { vector, .. } => vector[k],
                    };
                    self.universe.particles.velocities[i].0[k] += impulse * (1. - dist / r);
                }
            }
        }
        self.refresh();
        Ok(())
    }
}
