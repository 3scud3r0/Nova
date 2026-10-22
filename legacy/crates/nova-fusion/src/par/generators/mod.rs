// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from paulrobello/par-particle-life @ 6f495dae5b2bbb65fdafd2b7b6dab59142dfdf02.
// Copyright Paul Robello. Original and license retained in third_party/upstream.
// Procedural generators for rules, colors, and positions.

pub mod colors;
pub mod custom;
pub mod expression;
pub mod positions;
pub mod rules;

pub use colors::PaletteType;
pub use custom::CustomGenerator;
pub use expression::{EvalContext, Expr, ExprError};
pub use positions::{PositionPattern, SpawnConfig};
pub use rules::RuleType;

/// Deterministic CPU RNG used by every generator in this module.
///
/// Replaces the previous unseeded `rand::rng()` calls so generated matrices,
/// palettes, and spawn patterns are reproducible across runs for the same
/// inputs (ARC-019). All generators in `rules`, `colors`, `positions`, and
/// the DSL evaluator's `random()` builtin (via `expression.rs`) draw from a
/// `ChaCha8Rng` seeded with a fixed constant.
pub(crate) fn seeded_rng() -> rand_chacha::ChaCha8Rng {
    use rand::SeedableRng;
    // Fixed seed: same inputs always yield the same matrix/palette/pattern.
    // Bumping the seed is a one-line way to reshuffle every generator at once.
    rand_chacha::ChaCha8Rng::seed_from_u64(GENERATOR_SEED.with(|s| s.get()))
}

thread_local! {static GENERATOR_SEED:std::cell::Cell<u64>=const{std::cell::Cell::new(0x5EED_5EED_5EED_5EED)};}
/// Scoped, thread-local seed selection added by NOVA; restored even on unwinding.
pub fn with_seed<T>(seed: u64, f: impl FnOnce() -> T) -> T {
    struct Restore(u64);
    impl Drop for Restore {
        fn drop(&mut self) {
            GENERATOR_SEED.with(|s| s.set(self.0));
        }
    }
    let old = GENERATOR_SEED.with(|s| s.replace(seed));
    let _restore = Restore(old);
    f()
}
