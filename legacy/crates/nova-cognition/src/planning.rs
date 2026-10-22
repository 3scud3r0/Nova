//! Finite model-predictive control over five paint candidates, with exploration.
use crate::world_model::WorldModel;
use nova_core::SplitMix64;
use nova_substrates::Action;
pub fn encode(action: Option<&Action>) -> [f32; 4] {
    match action {
        Some(Action::Paint {
            position,
            radius,
            strength,
        }) => [
            position[0] * strength,
            position[1] * strength,
            *radius,
            *strength,
        ],
        Some(Action::Impulse { vector, radius, .. }) => [vector[0], vector[1], vector[2], *radius],
        None => [0.; 4],
    }
}
pub fn choose(
    model: &WorldModel,
    features: [f32; 16],
    focus: [f32; 3],
    strength: f32,
    rng: &mut SplitMix64,
) -> Option<Action> {
    let random = [rng.unit(), rng.unit(), rng.unit()];
    let candidates = [
        None,
        Some(Action::Paint {
            position: focus,
            radius: 0.04,
            strength,
        }),
        Some(Action::Paint {
            position: focus,
            radius: 0.04,
            strength: -strength,
        }),
        Some(Action::Paint {
            position: random,
            radius: 0.04,
            strength,
        }),
        Some(Action::Paint {
            position: random,
            radius: 0.04,
            strength: -strength,
        }),
    ];
    if rng.unit() < 0.2 {
        return candidates[(rng.next_u64() % candidates.len() as u64) as usize].clone();
    }
    let mut best = 0;
    let mut best_score = f32::NEG_INFINITY;
    for (index, action) in candidates.iter().enumerate() {
        let mut rollout = model.clone();
        let mut state = features;
        let mut score = 0.;
        for horizon in 0..3 {
            let control = if horizon == 0 {
                encode(action.as_ref())
            } else {
                [0.; 4]
            };
            let prediction = rollout.predict_conditioned(state, control);
            state = prediction.output.map(|x| x.clamp(-1., 1.));
            // Mass homeostasis plus bounded feature novelty, not a formal reward.
            score -= 0.8f32.powi(horizon) * (state[0] - 0.25f32.tanh()).abs();
            score += 0.01 * (state[5] - features[5]).abs().min(1.);
        }
        if score > best_score {
            best = index;
            best_score = score;
        }
    }
    candidates[best].clone()
}
