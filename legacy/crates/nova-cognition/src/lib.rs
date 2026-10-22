//! Modular predictive observer: spatial features, recurrent prediction, replay, action.
//! Region names describe functions; this is not a reconstruction of a human brain.
pub mod perception;
pub mod planning;
pub mod replay;
pub mod world_model;
use anyhow::{ensure, Result};
use nova_core::SplitMix64;
use nova_substrates::{Action, Substrate, TensorView};
use replay::{Replay, Transition};
use serde::{Deserialize, Serialize};
use world_model::{Prediction, WorldModel};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ObserverConfig {
    pub seed: u64,
    pub learning_rate: f32,
    pub replay_capacity: usize,
    pub sleep_every: u64,
    pub sleep_updates: usize,
    pub action_every: u64,
    pub motor_strength: f32,
}
impl Default for ObserverConfig {
    fn default() -> Self {
        Self {
            seed: 42,
            learning_rate: 0.005,
            replay_capacity: 1024,
            sleep_every: 128,
            sleep_updates: 64,
            action_every: 8,
            motor_strength: 0.15,
        }
    }
}
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct ObserverReport {
    pub samples: u64,
    pub prediction_mse: f32,
    pub learning_progress: f32,
    pub replay_updates: u64,
    pub actions: u64,
    pub sleeping: bool,
    pub homeostasis: f32,
    pub replay_len: usize,
}
pub struct Observer {
    pub config: ObserverConfig,
    pub model: WorldModel,
    pub replay: Replay,
    pub report: ObserverReport,
    previous: Option<Prediction>,
    rng: SplitMix64,
    last_loss: Option<f32>,
}
impl Observer {
    pub fn new(config: ObserverConfig) -> Result<Self> {
        ensure!(
            config.learning_rate.is_finite()
                && config.learning_rate > 0.
                && config.learning_rate <= 0.05
                && config.replay_capacity > 0
                && config.replay_capacity <= 65536
                && config.sleep_updates <= 65536
                && config.motor_strength.is_finite()
                && config.motor_strength.abs() <= 1.,
            "invalid observer configuration"
        );
        Ok(Self {
            model: WorldModel::new(config.seed),
            replay: Replay::new(config.replay_capacity),
            rng: SplitMix64(config.seed),
            report: Default::default(),
            previous: None,
            last_loss: None,
            config,
        })
    }
    /// Learn only from observations acquired before the proposed action is applied.
    pub fn observe(&mut self, view: TensorView<'_>, act: bool) -> Result<Option<Action>> {
        let features = perception::encode(view)?;
        let x = features.vector;
        self.report.sleeping = false;
        if let Some(previous) = self.previous.take() {
            let loss = self.model.train(&previous, x, self.config.learning_rate)?;
            self.report.learning_progress =
                self.last_loss.map(|old| (old - loss).max(0.)).unwrap_or(0.);
            self.last_loss = Some(loss);
            self.report.prediction_mse = loss;
            self.replay.insert(
                Transition {
                    x: previous.input,
                    y: x,
                    action: previous.action,
                    priority: loss + 0.001,
                },
                &mut self.rng,
            );
        }
        self.report.samples += 1;
        self.report.homeostasis = features.mass;
        if self.config.sleep_every > 0 && self.report.samples % self.config.sleep_every == 0 {
            self.sleep()?; // Synthetic replay updates: the environment is not stepped here.
        }
        self.report.replay_len = self.replay.len();
        let action = if act
            && self.config.action_every > 0
            && self.report.samples % self.config.action_every == 0
        {
            planning::choose(
                &self.model,
                x,
                features.focus,
                self.config.motor_strength,
                &mut self.rng,
            )
        } else {
            None
        };
        self.previous = Some(
            self.model
                .predict_conditioned(x, planning::encode(action.as_ref())),
        );
        if action.is_some() {
            self.report.actions += 1;
        }
        Ok(action)
    }
    pub fn sleep(&mut self) -> Result<()> {
        self.report.sleeping = true;
        for _ in 0..self.config.sleep_updates {
            let Some(t) = self.replay.sample(&mut self.rng) else {
                break;
            };
            let saved = self.model.hidden;
            self.model.hidden = [0.; 16];
            let p = self.model.predict_conditioned(t.x, t.action);
            self.model.train(&p, t.y, self.config.learning_rate)?;
            self.model.hidden = saved;
            self.report.replay_updates += 1;
        }
        Ok(())
    }
    pub fn tick(&mut self, substrate: &mut dyn Substrate, act: bool) -> Result<()> {
        if let Some(action) = self.observe(substrate.observe(), act)? {
            substrate.interact(&action)?;
        }
        substrate.step(1)
    }
}
