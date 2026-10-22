//! Independent rule-space exploration. No CatConway source is copied.
//! Behavior classes are numerical heuristics, not formal complexity classifications.
use crate::{Boundary, Grid, Rules};
use anyhow::{ensure, Result};
use serde::Serialize;
use std::collections::VecDeque;
#[derive(Debug, Clone, Serialize)]
pub struct Metrics {
    pub mean_density: f64,
    pub final_density: f64,
    pub density_range: f64,
    pub coefficient_of_variation: f64,
    pub activity: f64,
    pub shannon_entropy: f64,
    pub spatial_block_entropy: f64,
    pub trend: f64,
    pub lag1_autocorrelation: f64,
    pub monotonic_fraction: f64,
    pub roughness: f64,
    pub population_period: Option<usize>,
    pub exact_state_period: Option<usize>,
    pub langton_lambda: f64,
    pub behavior: &'static str,
}
pub struct Observer {
    densities: Vec<f64>,
    activities: Vec<f64>,
    history: VecDeque<Vec<u8>>,
    limit: usize,
    period: Option<usize>,
    blocks: f64,
}
impl Observer {
    pub fn new(cells: usize) -> Result<Self> {
        ensure!(cells > 0 && cells <= 16_777_216, "invalid observation size");
        Ok(Self {
            densities: vec![],
            activities: vec![],
            history: VecDeque::new(),
            limit: (32 * 1024 * 1024 / cells).clamp(1, 128),
            period: None,
            blocks: 0.,
        })
    }
    pub fn record(&mut self, g: &Grid, changed: u64) -> Result<()> {
        ensure!(
            self.densities.len() < 1_000_000,
            "observation budget exceeded"
        );
        self.densities
            .push(g.population() as f64 / g.cells.len() as f64);
        self.activities.push(changed as f64 / g.cells.len() as f64);
        self.period = self
            .history
            .iter()
            .rev()
            .position(|old| old == &g.cells)
            .map(|p| p + 1);
        self.history.push_back(g.cells.clone());
        while self.history.len() > self.limit {
            self.history.pop_front();
        }
        let mut counts = [0u64; 256];
        let zspan = if g.rules.dimensions == 3 { 2 } else { 1 };
        let zlast = if g.rules.dimensions == 3 {
            g.shape[2] - 1
        } else {
            1
        };
        for z in 0..zlast {
            for y in 0..g.shape[1] - 1 {
                for x in 0..g.shape[0] - 1 {
                    let mut pattern = 0;
                    for dz in 0..zspan {
                        for dy in 0..2 {
                            for dx in 0..2 {
                                let bit = dx + 2 * dy + 4 * dz;
                                pattern |= (g.get([
                                    (x + dx) as isize,
                                    (y + dy) as isize,
                                    (z + dz) as isize,
                                ]) as usize)
                                    << bit;
                            }
                        }
                    }
                    counts[pattern] += 1;
                }
            }
        }
        let n = counts.iter().sum::<u64>() as f64;
        self.blocks = counts
            .into_iter()
            .filter(|&c| c > 0)
            .map(|c| {
                let p = c as f64 / n;
                -p * p.log2()
            })
            .sum();
        Ok(())
    }
    pub fn finish(&self, rules: Rules) -> Result<Metrics> {
        rules.validate()?;
        ensure!(!self.densities.is_empty(), "no observations");
        let d = &self.densities;
        let n = d.len() as f64;
        let mean = d.iter().sum::<f64>() / n;
        let variance = d.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n;
        let cv = variance.sqrt() / mean.max(1e-12);
        let final_density = *d.last().unwrap();
        let range = d.iter().copied().fold(f64::NEG_INFINITY, f64::max)
            - d.iter().copied().fold(f64::INFINITY, f64::min);
        let activity = self.activities.iter().sum::<f64>() / n;
        let entropy = if mean > 0. && mean < 1. {
            -mean * mean.log2() - (1. - mean) * (1. - mean).log2()
        } else {
            0.
        };
        let trend = (final_density - d[0]) / n.max(2.);
        let autocorrelation = if variance > 1e-15 && d.len() > 1 {
            d.windows(2)
                .map(|x| (x[0] - mean) * (x[1] - mean))
                .sum::<f64>()
                / ((n - 1.) * variance)
        } else {
            0.
        };
        let monotonic = if d.len() > 1 {
            d.windows(2).filter(|x| x[1] >= x[0]).count() as f64 / (n - 1.)
        } else {
            0.
        };
        let roughness = if d.len() > 2 {
            d.windows(3)
                .map(|x| (x[2] - 2. * x[1] + x[0]).abs())
                .sum::<f64>()
                / (n - 2.)
        } else {
            0.
        };
        let period = (1..=128.min(d.len() / 2)).find(|&lag| {
            d.iter()
                .skip(lag)
                .zip(d)
                .all(|(a, b)| (a - b).abs() < 1e-12)
        });
        let behavior = if final_density == 0. {
            "dead"
        } else if activity == 0. {
            "static"
        } else if self.period.is_some() {
            "periodic"
        } else if final_density > 0.95 {
            "saturated"
        } else if trend > 0.001 {
            "growing"
        } else if trend < -0.001 {
            "declining"
        } else if activity > 0.35 {
            "chaotic-candidate"
        } else {
            "complex-candidate"
        };
        let neighbors = rules.max_neighbors();
        let mut transitions = 0f64;
        for k in 0..=neighbors {
            let mut choose = 1f64;
            for j in 0..k {
                choose *= ((neighbors - j) as f64) / ((j + 1) as f64);
            }
            transitions += choose * ((rules.birth >> k & 1) + (rules.survival >> k & 1)) as f64;
        }
        Ok(Metrics {
            mean_density: mean,
            final_density,
            density_range: range,
            coefficient_of_variation: cv,
            activity,
            shannon_entropy: entropy,
            spatial_block_entropy: self.blocks,
            trend,
            lag1_autocorrelation: autocorrelation,
            monotonic_fraction: monotonic,
            roughness,
            population_period: period,
            exact_state_period: self.period,
            langton_lambda: transitions / 2f64.powi((neighbors + 1) as i32),
            behavior,
        })
    }
}
#[derive(Serialize)]
pub struct Discovery {
    pub index: u64,
    pub rules: Rules,
    pub metrics: Metrics,
}
pub fn search(
    shape: [usize; 3],
    radius: u32,
    start: u64,
    limit: usize,
    ticks: usize,
    seed: u64,
) -> Result<Vec<Discovery>> {
    ensure!(
        limit > 0 && limit <= 4096 && ticks > 0 && ticks <= 4096,
        "bounded search requires 1..4096 rules/ticks"
    );
    let base = Rules {
        birth: 0,
        survival: 0,
        radius,
        dimensions: 2,
    };
    base.validate()?;
    let bits = base.max_neighbors() + 1;
    let maximum = 1u64 << (2 * bits);
    ensure!(
        start < maximum
            && start
                .checked_add(limit as u64)
                .is_some_and(|x| x <= maximum),
        "search range exceeds rule space"
    );
    let cells = shape
        .iter()
        .try_fold(1usize, |a, &b| a.checked_mul(b))
        .ok_or_else(|| anyhow::anyhow!("shape overflow"))?;
    ensure!(
        cells <= 262144 && (cells as u128) * (ticks as u128) * (limit as u128) <= 2_000_000_000,
        "search work budget exceeded"
    );
    let mask = (1u64 << bits) - 1;
    let mut output = Vec::with_capacity(limit);
    for index in start..start + limit as u64 {
        let rules = Rules {
            birth: (index & mask) as u32,
            survival: ((index >> bits) & mask) as u32,
            ..base
        };
        let mut grid = Grid::new(shape, rules, Boundary::Periodic)?;
        grid.randomize(seed, 0.2)?;
        let mut observer = Observer::new(cells)?;
        for _ in 0..ticks {
            let stats = grid.step()?;
            observer.record(&grid, stats.changed)?;
        }
        output.push(Discovery {
            index,
            rules,
            metrics: observer.finish(rules)?,
        });
    }
    Ok(output)
}
