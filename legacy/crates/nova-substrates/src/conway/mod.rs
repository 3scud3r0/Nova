pub mod bitboard;
pub mod compiler;
use crate::*;
use nova_automata::{Boundary, Grid};
pub struct ConwaySubstrate {
    pub grid: Grid,
    tensor: Vec<f32>,
}
pub fn build(s: &EnvironmentSpec) -> Result<Box<dyn Substrate>> {
    let dimensions = if s.kind == "conway-3d" { 3 } else { 2 };
    let expression = match s.kind.as_str() {
        "highlife" => "B36/S23",
        "seeds" => "B2/S",
        _ => &s.rule,
    };
    let rules = compiler::compile(expression, dimensions)?;
    let mut grid = Grid::new(s.shape, rules, Boundary::Periodic)?;
    grid.randomize(s.seed, 0.2)?;
    let mut model = ConwaySubstrate {
        tensor: vec![0.; 4 * grid.cells.len()],
        grid,
    };
    model.refresh();
    Ok(Box::new(model))
}
impl ConwaySubstrate {
    fn refresh(&mut self) {
        let n = self.grid.cells.len();
        for i in 0..n {
            self.tensor[i] = self.grid.cells[i] as f32;
        }
    }
}
impl Substrate for ConwaySubstrate {
    fn name(&self) -> &'static str {
        if self.grid.rules.dimensions == 3 {
            "conway-3d"
        } else {
            "conway"
        }
    }
    fn step(&mut self, ticks: usize) -> Result<()> {
        ensure!(ticks <= 1_000_000, "tick budget");
        if self.grid.rules.dimensions == 2
            && self.grid.rules.radius == 1
            && self.grid.shape[0] % 64 == 0
        {
            bitboard::advance(&mut self.grid, ticks)?;
        } else {
            for _ in 0..ticks {
                self.grid.step()?;
            }
        }
        self.refresh();
        Ok(())
    }
    fn observe(&self) -> TensorView<'_> {
        TensorView {
            shape: [
                4,
                self.grid.shape[2],
                self.grid.shape[1],
                self.grid.shape[0],
            ],
            values: &self.tensor,
            tick: self.grid.tick,
        }
    }
    fn interact(&mut self, action: &Action) -> Result<()> {
        action.validate()?;
        let Action::Paint {
            position,
            radius,
            strength,
        } = action
        else {
            anyhow::bail!("Conway accepts Paint")
        };
        let shape = self.grid.shape;
        let center = std::array::from_fn::<_, 3, _>(|k| position[k] * (shape[k] - 1) as f32);
        let rad = (radius * shape[0].min(shape[1]) as f32).max(0.5);
        for z in 0..shape[2] {
            for y in 0..shape[1] {
                for x in 0..shape[0] {
                    if ((x as f32 - center[0]).powi(2)
                        + (y as f32 - center[1]).powi(2)
                        + (z as f32 - center[2]).powi(2))
                        <= rad * rad
                    {
                        self.grid
                            .set([x as isize, y as isize, z as isize], *strength > 0.)
                    }
                }
            }
        }
        self.refresh();
        Ok(())
    }
}
