use anyhow::{ensure, Result};
use nova_cognition::{Observer, ObserverConfig};
use nova_substrates::{EnvironmentSpec, Registry};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EvaluationConfig {
    pub ticks: usize,
    pub warmup: usize,
    pub sample_every: usize,
    pub patience: usize,
    pub activity_floor: f64,
    pub observer: bool,
    pub interventions: bool,
}
impl Default for EvaluationConfig {
    fn default() -> Self {
        Self {
            ticks: 512,
            warmup: 32,
            sample_every: 4,
            patience: 16,
            activity_floor: 1e-7,
            observer: true,
            interventions: false,
        }
    }
}
impl EvaluationConfig {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.ticks > 0
                && self.ticks <= 1_000_000
                && self.warmup < self.ticks
                && self.sample_every > 0
                && self.sample_every <= self.ticks
                && self.patience > 0
                && self.patience <= 65536
                && self.activity_floor.is_finite()
                && self.activity_floor >= 0.,
            "invalid evaluation budget"
        );
        ensure!(
            !self.interventions || self.observer,
            "interventions require the observer"
        );
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Metrics {
    pub entropy: f64,
    pub autocorrelation: f64,
    pub activity: f64,
    pub occupied_fraction: f64,
    pub quality: f64,
    pub ticks: usize,
    pub early_terminated: bool,
    pub prediction_mse: f32,
    pub learning_progress: f32,
}
impl Metrics {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            [
                self.entropy,
                self.autocorrelation,
                self.activity,
                self.occupied_fraction,
                self.quality,
                self.prediction_mse as f64,
                self.learning_progress as f64
            ]
            .iter()
            .all(|x| x.is_finite())
                && (0.0..=1.).contains(&self.entropy)
                && (-1.0..=1.).contains(&self.autocorrelation)
                && (0.0..=1.).contains(&self.occupied_fraction)
                && self.quality >= 0.
                && self.ticks > 0
                && self.ticks <= 1_000_000,
            "invalid metrics"
        );
        Ok(())
    }
}
pub fn evaluate(spec: &EnvironmentSpec, config: &EvaluationConfig) -> Result<Metrics> {
    config.validate()?;
    let mut world = Registry::default().build(spec)?;
    let mut observer = if config.observer {
        Some(Observer::new(ObserverConfig {
            seed: spec.seed,
            ..Default::default()
        })?)
    } else {
        None
    };
    let mut previous = world.observe().values[..world.observe().spatial_len()].to_vec();
    let mut flat = 0;
    let mut activity = 0.;
    let mut correlation = 0.;
    let mut samples = 0f64;
    let mut entropy = 0.;
    let mut occupied = 0.;
    let mut ticks = 0;
    while ticks < config.ticks {
        let batch = config.sample_every.min(config.ticks - ticks);
        for _ in 0..batch {
            if let Some(o) = &mut observer {
                o.tick(world.as_mut(), config.interventions)?;
            } else {
                world.step(1)?;
            }
        }
        ticks += batch;
        let view = world.observe();
        let values = &view.values[..view.spatial_len()];
        let n = values.len() as f64;
        let mean = values.iter().map(|&x| x as f64).sum::<f64>() / n;
        let old_mean = previous.iter().map(|&x| x as f64).sum::<f64>() / n;
        let mut cov = 0.;
        let mut va = 0.;
        let mut vb = 0.;
        let mut change = 0.;
        let mut bins = [0usize; 16];
        for (&a, &b) in values.iter().zip(&previous) {
            let da = a as f64 - mean;
            let db = b as f64 - old_mean;
            cov += da * db;
            va += da * da;
            vb += db * db;
            change += (a as f64 - b as f64).abs();
            bins[(a.clamp(0., 1.) * 15.) as usize] += 1;
        }
        let moving = change / n;
        let corr = if va * vb > 1e-20 {
            (cov / (va * vb).sqrt()).clamp(-1., 1.)
        } else {
            0.
        };
        occupied = values.iter().filter(|&&x| x > 0.001).count() as f64 / n;
        entropy = bins
            .iter()
            .filter(|&&c| c > 0)
            .map(|&c| {
                let p = c as f64 / n;
                -p * p.ln() / 16f64.ln()
            })
            .sum();
        if ticks >= config.warmup {
            samples += 1.;
            activity += moving;
            correlation += corr;
            if moving <= config.activity_floor || occupied == 0. {
                flat += 1
            } else {
                flat = 0
            }
        }
        previous.copy_from_slice(values);
        if flat >= config.patience {
            break;
        }
    }
    let activity = activity / samples.max(1.);
    let autocorrelation = correlation / samples.max(1.);
    let prediction_mse = observer
        .as_ref()
        .map(|o| o.report.prediction_mse)
        .unwrap_or(0.);
    let progress = observer
        .as_ref()
        .map(|o| o.report.learning_progress)
        .unwrap_or(0.);
    // A declared finite fitness, not an inference of intelligence or scientific truth.
    let complexity = 4. * entropy * (1. - entropy);
    let quality = if occupied > 0. && activity > config.activity_floor {
        complexity
            * (1. - (-activity * 20.).exp())
            * (0.5 + 0.5 * autocorrelation.max(0.))
            * (1. + progress.min(1.) as f64)
    } else {
        0.
    };
    let m = Metrics {
        entropy,
        autocorrelation,
        activity,
        occupied_fraction: occupied,
        quality,
        ticks,
        early_terminated: ticks < config.ticks,
        prediction_mse,
        learning_progress: progress,
    };
    m.validate()?;
    Ok(m)
}
