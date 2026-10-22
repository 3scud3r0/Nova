//! Existing exact SIMD implementation for aligned periodic grids.
use anyhow::Result;
use nova_automata::Grid;
pub use nova_physics::conway::{Conway, Rule};
pub fn advance(grid: &mut Grid, ticks: usize) -> Result<()> {
    grid.validate()?;
    let width = grid.shape[0];
    let height = grid.shape[1];
    let mut words = vec![0u64; grid.cells.len() / 64];
    for (i, &cell) in grid.cells.iter().enumerate() {
        words[i / 64] |= (cell as u64) << (i % 64);
    }
    let mut packed = Conway {
        width,
        height,
        words,
        rule: Rule {
            birth: grid.rules.birth,
            survive: grid.rules.survival,
        },
        tick: grid.tick,
    };
    for _ in 0..ticks {
        packed.step();
    }
    for (i, cell) in grid.cells.iter_mut().enumerate() {
        *cell = ((packed.words[i / 64] >> (i % 64)) & 1) as u8;
    }
    grid.tick = packed.tick;
    Ok(())
}
