//! Port of primordial-dish's six-child matrix breeding (MIT, Matthias Puchstein).
use crate::Matrix;
use anyhow::{Result, ensure};
use nova_core::SplitMix64;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DishPreset {
    pub name: String,
    pub num_species: usize,
    pub rmax: f32,
    pub beta: f32,
    pub damping: f32,
    pub force_factor: f32,
    pub matrix: Vec<f32>,
}
impl DishPreset {
    pub fn matrix8(&self) -> Result<Matrix> {
        ensure!(
            (1..=8).contains(&self.num_species)
                && self.matrix.len() == self.num_species * self.num_species
                && self.matrix.iter().all(|x| x.is_finite() && x.abs() <= 1.),
            "invalid dish matrix"
        );
        Ok(std::array::from_fn(|i| {
            std::array::from_fn(|j| {
                if i < self.num_species && j < self.num_species {
                    self.matrix[i * self.num_species + j]
                } else {
                    0.
                }
            })
        }))
    }
}
pub fn preset(name: &str) -> Result<DishPreset> {
    let json = match name {
        "genesis" => include_str!(
            "../../../third_party/upstream/primordial-dish/godot/presets/01_genesis.json"
        ),
        "orbs" => {
            include_str!("../../../third_party/upstream/primordial-dish/godot/presets/02_orbs.json")
        }
        "garden" => include_str!(
            "../../../third_party/upstream/primordial-dish/godot/presets/03_garden.json"
        ),
        "symbiotes" => include_str!(
            "../../../third_party/upstream/primordial-dish/godot/presets/04_symbiotes.json"
        ),
        "polymers" => include_str!(
            "../../../third_party/upstream/primordial-dish/godot/presets/05_polymers.json"
        ),
        _ => anyhow::bail!("unknown primordial preset: {name}"),
    };
    let p: DishPreset = serde_json::from_str(json)?;
    p.matrix8()?;
    Ok(p)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RuleLineage {
    pub hash: String,
    pub parents: Vec<String>,
    pub generation: u32,
    pub operator: String,
}
impl RuleLineage {
    pub fn new(m: &Matrix, parents: Vec<String>, generation: u32, operator: &str) -> Self {
        let mut h = Sha256::new();
        for x in m.iter().flatten() {
            h.update(x.to_le_bytes());
        }
        for p in &parents {
            h.update(p.as_bytes());
        }
        h.update(generation.to_le_bytes());
        h.update(operator.as_bytes());
        Self {
            hash: format!("{:x}", h.finalize()),
            parents,
            generation,
            operator: operator.into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Candidate {
    pub matrix: Matrix,
    pub lineage: RuleLineage,
}
fn gaussian(rng: &mut SplitMix64) -> f32 {
    (-2. * rng.unit().max(1e-7).ln()).sqrt() * (std::f32::consts::TAU * rng.unit()).cos()
}
pub fn breed(
    parent: &Matrix,
    mate: &Matrix,
    k: usize,
    seed: u64,
    generation: u32,
) -> Result<Vec<Candidate>> {
    ensure!(
        (1..=8).contains(&k)
            && parent
                .iter()
                .flatten()
                .chain(mate.iter().flatten())
                .all(|x| x.is_finite() && x.abs() <= 1.),
        "invalid breeding parents"
    );
    let mut rng = SplitMix64(seed);
    let a = RuleLineage::new(parent, vec![], 0, "parent").hash;
    let b = RuleLineage::new(mate, vec![], 0, "mate").hash;
    let mut candidates = Vec::new();
    for child in 0..6 {
        let mut m = *parent;
        let op = match child {
            0 => "clone",
            1 => "mutate-0.08",
            2 => "mutate-0.18",
            3 => "mutate-0.35",
            4 => "row-crossover",
            _ => "wild",
        };
        for i in 0..k {
            let use_mate = child == 4 && rng.unit() < 0.5;
            for j in 0..k {
                m[i][j] = match child {
                    1..=3 => (m[i][j] + [0.08, 0.18, 0.35][child - 1] * gaussian(&mut rng))
                        .clamp(-1., 1.),
                    4 => {
                        if use_mate {
                            mate[i][j]
                        } else {
                            m[i][j]
                        }
                    }
                    5 => rng.signed(),
                    _ => m[i][j],
                };
            }
        }
        let parents = if child == 4 {
            vec![a.clone(), b.clone()]
        } else {
            vec![a.clone()]
        };
        let lineage = RuleLineage::new(&m, parents, generation, op);
        candidates.push(Candidate { matrix: m, lineage });
    }
    Ok(candidates)
}
