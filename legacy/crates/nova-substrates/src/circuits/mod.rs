//! Exact Wireworld: empty=0, head=1, tail=2, conductor=3.
pub mod gates;
use crate::*;
pub struct Wireworld {
    shape: [usize; 2],
    cells: Vec<u8>,
    tensor: Vec<f32>,
    tick: u64,
}
pub fn build(s: &EnvironmentSpec) -> Result<Box<dyn Substrate>> {
    let shape = grid_shape(s)?;
    let [w, h] = shape;
    let mut cells = vec![0; w * h];
    // A closed rectangular wire with one travelling pulse.
    for x in 2..w - 2 {
        cells[2 * w + x] = 3;
        cells[(h - 3) * w + x] = 3;
    }
    for y in 2..h - 2 {
        cells[y * w + 2] = 3;
        cells[y * w + w - 3] = 3;
    }
    cells[2 * w + 3] = 2;
    cells[2 * w + 4] = 1;
    let mut a = Wireworld {
        shape,
        cells,
        tensor: vec![0.; 4 * w * h],
        tick: 0,
    };
    a.refresh();
    Ok(Box::new(a))
}
impl Wireworld {
    fn refresh(&mut self) {
        let n = self.cells.len();
        for i in 0..n {
            self.tensor[i] = self.cells[i] as f32 / 3.;
            self.tensor[3 * n + i] = f32::from(self.cells[i] == 1);
        }
    }
}
impl Substrate for Wireworld {
    fn name(&self) -> &'static str {
        "wireworld"
    }
    fn step(&mut self, ticks: usize) -> Result<()> {
        ensure!(ticks <= 1_000_000, "tick budget");
        let [w, h] = self.shape;
        for _ in 0..ticks {
            let mut next = self.cells.clone();
            for y in 0..h {
                for x in 0..w {
                    let i = y * w + x;
                    next[i] = match self.cells[i] {
                        0 => 0,
                        1 => 2,
                        2 => 3,
                        _ => {
                            let mut heads = 0;
                            for dy in -1..=1 {
                                for dx in -1..=1 {
                                    if dx == 0 && dy == 0 {
                                        continue;
                                    }
                                    let xx = x as isize + dx;
                                    let yy = y as isize + dy;
                                    if xx >= 0
                                        && yy >= 0
                                        && xx < w as isize
                                        && yy < h as isize
                                        && self.cells[yy as usize * w + xx as usize] == 1
                                    {
                                        heads += 1
                                    }
                                }
                            }
                            if heads == 1 || heads == 2 {
                                1
                            } else {
                                3
                            }
                        }
                    };
                }
            }
            self.cells = next;
            self.tick += 1;
        }
        self.refresh();
        Ok(())
    }
    fn observe(&self) -> TensorView<'_> {
        TensorView {
            shape: [4, 1, self.shape[1], self.shape[0]],
            values: &self.tensor,
            tick: self.tick,
        }
    }
    fn interact(&mut self, a: &Action) -> Result<()> {
        paint_grid(self.shape, a, |i, s| {
            self.cells[i] = if s < 0. {
                0
            } else if s > 1. {
                1
            } else {
                3
            }
        })?;
        self.refresh();
        Ok(())
    }
}
