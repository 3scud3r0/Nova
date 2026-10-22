use anyhow::{ensure, Result};
use nova_core::SplitMix64;
use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
pub struct WorldModel {
    pub hidden: [f32; 16],
    recurrent: [[f32; 16]; 16],
    sensory: [[f32; 16]; 16],
    decoder: [[f32; 16]; 16],
    actuator: [[f32; 4]; 16],
}
pub struct Prediction {
    pub input: [f32; 16],
    pub action: [f32; 4],
    previous: [f32; 16],
    hidden: [f32; 16],
    activation: [f32; 16],
    pub output: [f32; 16],
}
impl WorldModel {
    pub fn new(seed: u64) -> Self {
        let mut rng = SplitMix64(seed);
        Self {
            hidden: [0.; 16],
            actuator: std::array::from_fn(|_| std::array::from_fn(|_| rng.signed() * 0.02)),
            recurrent: std::array::from_fn(|_| std::array::from_fn(|_| rng.signed() * 0.02)),
            sensory: std::array::from_fn(|_| std::array::from_fn(|_| rng.signed() * 0.1)),
            decoder: std::array::from_fn(|_| std::array::from_fn(|_| rng.signed() * 0.02)),
        }
    }
    pub fn predict(&mut self, input: [f32; 16]) -> Prediction {
        self.predict_conditioned(input, [0.; 4])
    }
    pub fn predict_conditioned(&mut self, input: [f32; 16], action: [f32; 4]) -> Prediction {
        let previous = self.hidden;
        let mut activation = [0.; 16];
        for i in 0..16 {
            let z = ((0..16)
                .map(|j| self.recurrent[i][j] * previous[j] + self.sensory[i][j] * input[j])
                .sum::<f32>()
                + (0..4).map(|j| self.actuator[i][j] * action[j]).sum::<f32>())
            .tanh();
            activation[i] = z;
            self.hidden[i] = 0.75 * previous[i] + 0.25 * z;
        }
        // Residual predictor starts close to the persistence baseline.
        let output = std::array::from_fn(|i| {
            input[i]
                + (0..16)
                    .map(|j| self.decoder[i][j] * self.hidden[j])
                    .sum::<f32>()
        });
        Prediction {
            input,
            action,
            previous,
            hidden: self.hidden,
            activation,
            output,
        }
    }
    /// One-step truncated gradient; not full BPTT or a trained foundation model.
    pub fn train(&mut self, p: &Prediction, target: [f32; 16], rate: f32) -> Result<f32> {
        ensure!(
            target.iter().chain(&p.output).all(|x| x.is_finite())
                && rate.is_finite()
                && rate > 0.
                && rate <= 0.05,
            "invalid prediction update"
        );
        let error = std::array::from_fn::<_, 16, _>(|i| p.output[i] - target[i]);
        let loss = error.iter().map(|e| e * e).sum::<f32>() / 16.;
        let hidden_grad = std::array::from_fn::<_, 16, _>(|j| {
            (0..16)
                .map(|i| error[i] * self.decoder[i][j] / 8.)
                .sum::<f32>()
                * 0.25
                * (1. - p.activation[j] * p.activation[j])
        });
        for i in 0..16 {
            for j in 0..4 {
                self.actuator[i][j] = (self.actuator[i][j]
                    - rate * (hidden_grad[i] * p.action[j]).clamp(-1., 1.))
                .clamp(-2., 2.);
            }
            for j in 0..16 {
                self.decoder[i][j] = (self.decoder[i][j]
                    - rate * (error[i] * p.hidden[j] / 8.).clamp(-1., 1.))
                .clamp(-2., 2.);
                self.sensory[i][j] = (self.sensory[i][j]
                    - rate * (hidden_grad[i] * p.input[j]).clamp(-1., 1.))
                .clamp(-2., 2.);
                self.recurrent[i][j] -= rate * (hidden_grad[i] * p.previous[j]).clamp(-1., 1.);
            }
            let norm = self.recurrent[i].iter().map(|x| x.abs()).sum::<f32>();
            if norm > 0.9 {
                for w in &mut self.recurrent[i] {
                    *w *= 0.9 / norm;
                }
            }
        }
        Ok(loss)
    }
}
