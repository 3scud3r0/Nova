//! Object-safe substrate plugins with borrowed, channel-first tensor observations.
pub mod circuits;
pub mod conway;
pub mod fluids;
pub mod lenia;
pub mod particles;
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EnvironmentSpec {
    pub kind: String,
    pub shape: [usize; 3],
    pub particles: usize,
    pub seed: u64,
    pub rule: String,
    pub matrix: Option<[[f32; 8]; 8]>,
    pub damping: Option<f32>,
    pub strength: Option<f32>,
    pub neural: Option<nova_physics::neural::NeuralConfig>,
    /// Substrate-specific bounded coefficients; see each adapter.
    pub parameters: [f32; 4],
    pub genome: Option<[u8; 16]>,
}
impl Default for EnvironmentSpec {
    fn default() -> Self {
        Self {
            kind: "conway".into(),
            shape: [64, 64, 1],
            particles: 512,
            seed: 42,
            rule: "B3/S23".into(),
            matrix: None,
            damping: None,
            strength: None,
            neural: None,
            parameters: [0.04, 0.06, 0.15, 0.015],
            genome: None,
        }
    }
}
impl EnvironmentSpec {
    pub fn for_kind(kind: &str, seed: u64) -> Self {
        let mut s = Self {
            kind: kind.into(),
            seed,
            ..Self::default()
        };
        if kind == "highlife" {
            s.rule = "B36/S23".into();
        }
        if kind == "seeds" {
            s.rule = "B2/S".into();
        }
        if kind == "lenia" {
            s.parameters = [0.15, 0.015, 0.1, 10.];
        }
        if kind == "gray-scott" {
            s.parameters = [0.04, 0.06, 0.16, 0.08];
        }
        if kind == "navier-stokes" {
            s.parameters = [0.001, 0., 0.1, 0.];
        }
        if kind == "conway-3d" {
            s.shape = [32, 32, 32];
            s.rule = "B5/S4-5".into();
        }
        s
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(
            !self.kind.is_empty() && self.kind.len() <= 64 && self.rule.len() <= 256,
            "substrate name/rule encoding budget exceeded"
        );
        let n = self.shape.iter().try_fold(1usize, |a, &b| a.checked_mul(b));
        ensure!(
            self.shape.iter().all(|&x| x > 0)
                && n.is_some_and(|n| n <= 2_097_152)
                && self.particles > 0
                && self.particles <= 262144,
            "substrate capacity exceeded"
        );
        ensure!(
            self.parameters.iter().all(|x| x.is_finite()),
            "nonfinite substrate parameters"
        );
        ensure!(
            self.damping
                .is_none_or(|x| x.is_finite() && (0.0..=20.).contains(&x))
                && self
                    .strength
                    .is_none_or(|x| x.is_finite() && (0.0..=100.).contains(&x)),
            "invalid damping/strength genes"
        );
        if let Some(m) = self.matrix {
            ensure!(
                m.iter().flatten().all(|x| x.is_finite() && x.abs() <= 1.),
                "invalid matrix"
            )
        }
        if let Some(n) = &self.neural {
            n.validate()?;
            ensure!(
                particles::accepts_neural(&self.kind),
                "neural organisms require a particle substrate"
            )
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Action {
    Paint {
        position: [f32; 3],
        radius: f32,
        strength: f32,
    },
    Impulse {
        position: [f32; 3],
        radius: f32,
        vector: [f32; 3],
    },
}
impl Action {
    pub fn validate(&self) -> Result<()> {
        let (position, radius) = match self {
            Self::Paint {
                position,
                radius,
                strength,
            } => {
                ensure!(
                    strength.is_finite() && strength.abs() <= 10.,
                    "invalid strength"
                );
                (position, radius)
            }
            Self::Impulse {
                position,
                radius,
                vector,
            } => {
                ensure!(
                    vector.iter().all(|x| x.is_finite() && x.abs() <= 10.),
                    "invalid impulse"
                );
                (position, radius)
            }
        };
        ensure!(
            position
                .iter()
                .all(|x| x.is_finite() && (0.0..=1.).contains(x))
                && radius.is_finite()
                && *radius > 0.
                && *radius <= 1.,
            "invalid normalized action"
        );
        Ok(())
    }
}
#[derive(Clone, Copy)]
pub struct TensorView<'a> {
    pub shape: [usize; 4],
    pub values: &'a [f32],
    pub tick: u64,
}
impl TensorView<'_> {
    pub fn channels(&self) -> usize {
        self.shape[0]
    }
    pub fn spatial_len(&self) -> usize {
        self.values.len() / self.shape[0]
    }
}
pub trait Substrate: Send + Sync {
    /// Integrator time per tick; discrete games use one logical time unit.
    fn time_step(&self) -> f32 {
        1.
    }
    /// Optional native particle columns for multimodal cortex observation.
    fn particle_view(&self) -> Option<&nova_core::Particles> {
        None
    }
    fn name(&self) -> &'static str;
    fn step(&mut self, ticks: usize) -> Result<()>;
    fn observe(&self) -> TensorView<'_>;
    fn interact(&mut self, action: &Action) -> Result<()>;
}
pub type Factory = fn(&EnvironmentSpec) -> Result<Box<dyn Substrate>>;
pub struct Registry {
    factories: BTreeMap<String, Factory>,
}
impl Default for Registry {
    fn default() -> Self {
        let mut r = Self {
            factories: BTreeMap::new(),
        };
        for name in ["conway", "conway-3d", "highlife", "seeds"] {
            r.factories.insert(name.into(), conway::build as Factory);
        }
        for name in [
            "particle-life",
            "particle-vm",
            "fusion",
            "hunar",
            "realethersim",
            "primordial-dish",
            "par-particle-life",
            "cellflow",
        ] {
            r.factories.insert(name.into(), particles::build as Factory);
        }
        for name in ["mpm", "gray-scott", "navier-stokes"] {
            r.factories.insert(name.into(), fluids::build as Factory);
        }
        r.factories.insert("wireworld".into(), circuits::build);
        r.factories.insert("lenia".into(), lenia::build);
        r
    }
}
impl Registry {
    pub fn register(&mut self, name: &str, factory: Factory) -> Result<()> {
        ensure!(
            !name.is_empty() && !self.factories.contains_key(name),
            "duplicate/empty plugin"
        );
        self.factories.insert(name.into(), factory);
        Ok(())
    }
    pub fn names(&self) -> Vec<&str> {
        self.factories.keys().map(String::as_str).collect()
    }
    pub fn build(&self, spec: &EnvironmentSpec) -> Result<Box<dyn Substrate>> {
        spec.validate()?;
        self.factories
            .get(&spec.kind)
            .ok_or_else(|| anyhow::anyhow!("unknown substrate {}", spec.kind))?(spec)
    }
}
pub(crate) fn grid_shape(s: &EnvironmentSpec) -> Result<[usize; 2]> {
    ensure!(
        s.shape[2] == 1
            && s.shape[0] >= 8
            && s.shape[1] >= 8
            && s.shape[0] <= 1024
            && s.shape[1] <= 1024,
        "requires bounded 2D grid >=8"
    );
    Ok([s.shape[0], s.shape[1]])
}
pub(crate) fn paint_grid(
    shape: [usize; 2],
    action: &Action,
    mut apply: impl FnMut(usize, f32),
) -> Result<()> {
    action.validate()?;
    let Action::Paint {
        position,
        radius,
        strength,
    } = action
    else {
        anyhow::bail!("this discrete substrate accepts Paint actions")
    };
    let [w, h] = shape;
    let scale = w.min(h) as f32;
    let r = (radius * scale).max(0.5);
    for y in 0..h {
        for x in 0..w {
            if ((x as f32 - position[0] * (w - 1) as f32).powi(2)
                + (y as f32 - position[1] * (h - 1) as f32).powi(2))
                <= r * r
            {
                apply(y * w + x, *strength)
            }
        }
    }
    Ok(())
}
