//! Bounded, resumable MAP-Elites with deterministic island migration.
pub mod archive;
pub mod evaluation;
use anyhow::{ensure, Result};
pub use archive::{Archive, Elite};
pub use evaluation::{evaluate, EvaluationConfig, Metrics};
use nova_core::SplitMix64;
use nova_substrates::EnvironmentSpec;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};
#[derive(Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SearchConfig {
    pub seed: u64,
    pub islands: usize,
    pub epochs: usize,
    pub candidates_per_epoch: usize,
    pub bins: usize,
    pub migration_fraction: f32,
    pub neural: bool,
    pub evaluation: EvaluationConfig,
}
impl Default for SearchConfig {
    fn default() -> Self {
        Self {
            seed: 42,
            islands: 4,
            epochs: 10,
            candidates_per_epoch: 8,
            bins: 16,
            migration_fraction: 0.05,
            neural: false,
            evaluation: Default::default(),
        }
    }
}
impl SearchConfig {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.islands > 0
                && self.islands <= 256
                && self.epochs > 0
                && self.epochs <= 100000
                && self.candidates_per_epoch > 0
                && self.candidates_per_epoch <= 4096
                && (2..=128).contains(&self.bins)
                && self.migration_fraction.is_finite()
                && (0.0..=0.5).contains(&self.migration_fraction),
            "invalid search budgets"
        );
        self.evaluation.validate()
    }
}
struct Island {
    cells: BTreeMap<(usize, usize), Elite>,
    rng: SplitMix64,
    iteration: u64,
}
fn mutate(parent: &EnvironmentSpec, rng: &mut SplitMix64) -> Result<EnvironmentSpec> {
    let mut spec = parent.clone();
    spec.seed = rng.next_u64();
    if matches!(
        spec.kind.as_str(),
        "conway" | "conway-3d" | "highlife" | "seeds"
    ) {
        spec.kind = if spec.shape[2] > 1 {
            "conway-3d"
        } else {
            "conway"
        }
        .into();
        let dimension = if spec.shape[2] > 1 { 3 } else { 2 };
        let mut rule = nova_automata::Rules::parse(&spec.rule, dimension, 1)?;
        let bit = 1u32 << (rng.next_u64() % (rule.max_neighbors() as u64 + 1));
        if rng.unit() < 0.5 {
            rule.birth ^= bit
        } else {
            rule.survival ^= bit
        }
        let encode = |mask: u32| {
            (0..=rule.max_neighbors())
                .filter(|&i| mask & (1 << i) != 0)
                .map(|i| i.to_string())
                .collect::<Vec<_>>()
                .join(",")
        };
        spec.rule = format!(
            "B{{{}}}/S{{{}}}/R{}",
            encode(rule.birth),
            encode(rule.survival),
            rule.radius
        );
    } else if matches!(spec.kind.as_str(), "lenia" | "gray-scott" | "navier-stokes") {
        let k = (rng.next_u64() % 4) as usize;
        spec.parameters[k] *= 1. + 0.1 * rng.signed();
        match spec.kind.as_str() {
            "lenia" => {
                spec.parameters[0] = spec.parameters[0].clamp(0.01, 0.9);
                spec.parameters[1] = spec.parameters[1].clamp(0.001, 0.5);
                spec.parameters[2] = spec.parameters[2].clamp(0.005, 0.25);
                spec.parameters[3] =
                    spec.parameters[3].clamp(1., spec.shape[0].min(spec.shape[1]) as f32 / 2.);
            }
            "gray-scott" => {
                for x in &mut spec.parameters[..2] {
                    *x = x.clamp(0., 0.1)
                }
                for x in &mut spec.parameters[2..] {
                    *x = x.clamp(0.001, 0.25)
                }
            }
            _ => {
                spec.parameters[0] = spec.parameters[0].clamp(0., 1.);
                spec.parameters[2] = spec.parameters[2].clamp(0.001, 0.2);
            }
        }
    } else if !matches!(spec.kind.as_str(), "wireworld" | "mpm") {
        let mut m = spec
            .matrix
            .unwrap_or_else(|| std::array::from_fn(|_| std::array::from_fn(|_| rng.signed())));
        // Periodically sample the existing named generator catalog; otherwise mutate locally.
        if rng.unit() < 0.1 {
            use nova_fusion::par::generators::{
                rules::{generate_rules, RuleType},
                with_seed,
            };
            let rule = RuleType::all()[(rng.next_u64() % 34) as usize];
            let generated = with_seed(rng.next_u64(), || generate_rules(rule, 8));
            m = std::array::from_fn(|i| std::array::from_fn(|j| generated.get(i, j)));
        } else {
            for row in &mut m {
                for x in row {
                    if rng.unit() < 0.2 {
                        *x = (*x + 0.15 * rng.signed()).clamp(-1., 1.)
                    }
                }
            }
        }
        spec.matrix = Some(m);
        if rng.unit() < 0.2 {
            spec.damping = Some((spec.damping.unwrap_or(1.8) + rng.signed() * 0.2).clamp(0., 20.));
        }
        if rng.unit() < 0.2 {
            spec.strength =
                Some((spec.strength.unwrap_or(4.) + rng.signed() * 0.4).clamp(0., 100.));
        }
    }
    if spec.neural.is_some() || spec.kind == "particle-vm" {
        let mut tape = spec
            .genome
            .unwrap_or_else(|| std::array::from_fn(|_| rng.next_u64() as u8));
        for b in &mut tape {
            if rng.unit() < 0.125 {
                *b ^= 1 << (rng.next_u64() % 8)
            }
        }
        spec.genome = Some(tape);
    }
    spec.validate()?;
    Ok(spec)
}
/// Search only runs when called by CLI/library consumers, never at build time.
pub fn search(
    directory: &Path,
    initial: EnvironmentSpec,
    config: SearchConfig,
) -> Result<archive::Summary> {
    config.validate()?;
    initial.validate()?;
    ensure!(
        initial
            .shape
            .iter()
            .product::<usize>()
            .saturating_mul(config.islands)
            <= 16_777_216
            && initial.particles.saturating_mul(config.islands) <= 2_097_152
            && config.islands.saturating_mul(config.bins * config.bins) <= 8192,
        "aggregate island memory budget exceeded"
    );
    ensure!(
        !config.neural || nova_substrates::particles::accepts_neural(&initial.kind),
        "--neural requires particles"
    );
    let mut initial = initial;
    if config.neural {
        initial.neural = Some(Default::default());
    }
    let mut archive = Archive::open(directory, config.bins)?;
    let state_path = directory.join("search-state.json");
    #[derive(Serialize, Deserialize)]
    struct Checkpoint {
        schema: String,
        config: SearchConfig,
        initial: EnvironmentSpec,
        completed: usize,
        islands: Vec<IslandState>,
    }
    #[derive(Serialize, Deserialize)]
    struct IslandState {
        rng: u64,
        iteration: u64,
        cells: Vec<Elite>,
    }
    let mut completed = 0;
    let mut islands: Vec<_> = (0..config.islands)
        .map(|i| Island {
            cells: archive.cells.clone(),
            rng: SplitMix64(config.seed.wrapping_add(i as u64 * 7919)),
            iteration: 0,
        })
        .collect();
    if state_path.exists() {
        let raw = std::fs::read(&state_path)?;
        ensure!(raw.len() <= 64 * 1024 * 1024, "checkpoint too large");
        let saved: Checkpoint = serde_json::from_slice(&raw)?;
        let mut previous = saved.config.clone();
        previous.epochs = config.epochs;
        ensure!(
            saved.schema == "NOVA-SEARCH-v1"
                && serde_json::to_vec(&previous)? == serde_json::to_vec(&config)?
                && serde_json::to_vec(&saved.initial)? == serde_json::to_vec(&initial)?
                && saved.islands.len() == config.islands,
            "resume configuration differs (only epochs can increase)"
        );
        completed = saved.completed;
        for (island, state) in islands.iter_mut().zip(saved.islands) {
            island.rng = SplitMix64(state.rng);
            island.iteration = state.iteration;
            island.cells.clear();
            for elite in state.cells {
                elite.validate()?;
                island
                    .cells
                    .insert(archive::bin(&elite.metrics, config.bins), elite);
            }
        }
    }
    for epoch in completed..config.epochs {
        let results: Vec<Result<(Vec<Elite>, Vec<(u64, String)>)>> = islands
            .par_iter_mut()
            .map(|island| {
                let mut discoveries = Vec::new();
                let mut rejected = Vec::new();
                for _ in 0..config.candidates_per_epoch {
                    let parent = if island.cells.is_empty() {
                        &initial
                    } else {
                        &island
                            .cells
                            .values()
                            .nth(island.rng.next_u64() as usize % island.cells.len())
                            .unwrap()
                            .spec
                    };
                    let spec = if island.iteration == 0 {
                        let mut p = initial.clone();
                        p.seed = island.rng.next_u64();
                        p
                    } else {
                        mutate(parent, &mut island.rng)?
                    };
                    island.iteration += 1;
                    let metrics = match evaluate(&spec, &config.evaluation) {
                        Ok(metrics) => metrics,
                        Err(error) => {
                            rejected.push((spec.seed, error.to_string()));
                            continue;
                        }
                    };
                    let elite = Elite::new(spec, config.evaluation.clone(), metrics)?;
                    let bin = archive::bin(&elite.metrics, config.bins);
                    if island
                        .cells
                        .get(&bin)
                        .is_none_or(|old| elite.metrics.quality > old.metrics.quality)
                    {
                        island.cells.insert(bin, elite.clone());
                    }
                    discoveries.push(elite);
                }
                Ok((discoveries, rejected))
            })
            .collect();
        for batch in results {
            let (discoveries, rejected) = batch?;
            for (seed, reason) in rejected {
                archive.record_rejection(seed, &reason)?;
            }
            for elite in discoveries {
                archive.insert(elite)?;
            }
        }
        // Remote claims never directly win a niche: re-evaluate their environment locally.
        for spec in archive.pending_specs(16)? {
            match evaluate(&spec, &config.evaluation) {
                Ok(metrics) => {
                    let island_index = spec.seed as usize % islands.len();
                    let elite = Elite::new(spec, config.evaluation.clone(), metrics)?;
                    if archive.insert(elite.clone())? {
                        let bin = archive::bin(&elite.metrics, config.bins);
                        islands[island_index].cells.insert(bin, elite);
                    }
                }
                Err(error) => archive.record_rejection(spec.seed, &error.to_string())?,
            }
        }
        let migrants: Vec<Vec<_>> = islands
            .iter()
            .map(|island| {
                let mut elites: Vec<_> = island.cells.values().cloned().collect();
                elites.sort_by(|a, b| {
                    b.metrics
                        .quality
                        .total_cmp(&a.metrics.quality)
                        .then(a.hash.cmp(&b.hash))
                });
                let count = (elites.len() as f32 * config.migration_fraction).ceil() as usize;
                elites.truncate(count);
                elites
            })
            .collect();
        for i in 0..islands.len() {
            for elite in &migrants[i] {
                let next = (i + 1) % islands.len();
                let bin = archive::bin(&elite.metrics, config.bins);
                if islands[next]
                    .cells
                    .get(&bin)
                    .is_none_or(|old| elite.metrics.quality > old.metrics.quality)
                {
                    islands[next].cells.insert(bin, elite.clone());
                }
            }
        }
        archive.flush()?;
        let checkpoint = Checkpoint {
            schema: "NOVA-SEARCH-v1".into(),
            config: config.clone(),
            initial: initial.clone(),
            completed: epoch + 1,
            islands: islands
                .iter()
                .map(|i| IslandState {
                    rng: i.rng.0,
                    iteration: i.iteration,
                    cells: i.cells.values().cloned().collect(),
                })
                .collect(),
        };
        archive::atomic_json(&state_path, &checkpoint)?;
    }
    Ok(archive.summary())
}
