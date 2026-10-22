//! Four-state contractive controller. The 64-byte particle ABI is unchanged.
use serde::{Deserialize, Serialize};
/// 32 signed four-bit weights: 16 recurrent and 16 sensory weights.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Memory {
    pub hidden: [f32; 4],
    pub age: u64,
}
fn weight(tape: &[u8; 16], n: usize) -> f32 {
    let bits = (tape[n / 2] >> (4 * (n % 2))) & 15;
    (if bits >= 8 {
        bits as i32 - 16
    } else {
        bits as i32
    }) as f32
        / 8.
}
impl Memory {
    /// Input: density, chemical gradient, relative flow, mechanical stress.
    /// Recurrent row L1 norm <= 0.8; tanh is 1-Lipschitz. With leak .25,
    /// the fixed-input hidden update has infinity-norm Lipschitz bound .95.
    pub fn update(&mut self, tape: &[u8; 16], input: [f32; 4]) -> [f32; 4] {
        let previous = self.hidden;
        for i in 0..4 {
            let row = std::array::from_fn::<_, 4, _>(|j| weight(tape, i * 4 + j));
            let scale = 0.8 / row.iter().map(|x| x.abs()).sum::<f32>().max(0.8);
            let recurrent: f32 = (0..4).map(|j| row[j] * scale * previous[j]).sum();
            let sense: f32 = (0..4)
                .map(|j| weight(tape, 16 + i * 4 + j) * input[j].clamp(-1., 1.))
                .sum();
            self.hidden[i] = 0.75 * previous[i] + 0.25 * (recurrent + sense).tanh();
        }
        self.age = self.age.saturating_add(1);
        self.hidden
    }
}
