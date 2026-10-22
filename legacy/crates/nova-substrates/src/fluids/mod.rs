pub mod grid;
use crate::*;
use grid::*;
pub fn build(s: &EnvironmentSpec) -> Result<Box<dyn Substrate>> {
    if s.kind == "mpm" {
        return Ok(Box::new(crate::particles::ParticleSubstrate::new(s, true)?));
    }
    let shape = grid_shape(s)?;
    let [w, h] = shape;
    let n = w * h;
    let mut tensor = vec![0.; 4 * n];
    let mut rng = nova_core::SplitMix64(s.seed);
    let gray = s.kind == "gray-scott";
    if gray {
        tensor[..n].fill(1.);
        for y in h / 3..2 * h / 3 {
            for x in w / 3..2 * w / 3 {
                tensor[y * w + x] = 0.5;
                tensor[3 * n + y * w + x] = 0.25 + 0.02 * rng.signed();
            }
        }
    } else {
        for y in 0..h {
            for x in 0..w {
                let i = y * w + x;
                let xx = x as f32 / w as f32 * std::f32::consts::TAU;
                let yy = y as f32 / h as f32 * std::f32::consts::TAU;
                tensor[n + i] = xx.sin() * yy.cos();
                tensor[2 * n + i] = -xx.cos() * yy.sin();
                tensor[i] = (-((xx - 3.).powi(2) + (yy - 3.).powi(2))).exp();
            }
        }
    }
    let [a, b, c, d] = s.parameters;
    if gray {
        ensure!(
            [a, b].iter().all(|x| (0.0..=0.1).contains(x))
                && [c, d].iter().all(|x| *x > 0. && *x <= 0.25),
            "invalid Gray-Scott feed/kill/diffusivities"
        );
    } else {
        ensure!(
            a >= 0. && a <= 1. && c > 0. && c <= 0.25 && a * c <= 0.2,
            "invalid viscosity/time step"
        );
    }
    Ok(Box::new(Field {
        shape,
        tensor,
        tick: 0,
        gray,
        parameters: s.parameters,
    }))
}
pub struct Field {
    shape: [usize; 2],
    tensor: Vec<f32>,
    tick: u64,
    gray: bool,
    parameters: [f32; 4],
}
impl Substrate for Field {
    fn time_step(&self) -> f32 {
        if self.gray {
            1.
        } else {
            self.parameters[2]
        }
    }
    fn name(&self) -> &'static str {
        if self.gray {
            "gray-scott"
        } else {
            "navier-stokes"
        }
    }
    fn step(&mut self, ticks: usize) -> Result<()> {
        ensure!(ticks <= 1_000_000, "tick budget");
        let [w, h] = self.shape;
        let n = w * h;
        for _ in 0..ticks {
            if self.gray {
                let [feed, kill, da, db] = self.parameters;
                let old = self.tensor.clone();
                let a = &old[..n];
                let b = &old[3 * n..];
                for y in 0..h {
                    for x in 0..w {
                        let i = y * w + x;
                        let reaction = a[i] * b[i] * b[i];
                        self.tensor[i] = (a[i] + da * laplacian(a, x, y, w, h) - reaction
                            + feed * (1. - a[i]))
                            .clamp(0., 1.);
                        self.tensor[3 * n + i] = (b[i] + db * laplacian(b, x, y, w, h) + reaction
                            - (feed + kill) * b[i])
                            .clamp(0., 1.);
                    }
                }
            } else {
                let visc = self.parameters[0];
                let dt = self.parameters[2];
                let old = self.tensor.clone();
                let u = &old[n..2 * n];
                let v = &old[2 * n..3 * n];
                for y in 0..h {
                    for x in 0..w {
                        let i = y * w + x;
                        let xx = x as f32 - dt * u[i];
                        let yy = y as f32 - dt * v[i];
                        self.tensor[n + i] =
                            sample(u, xx, yy, w, h) + dt * visc * laplacian(u, x, y, w, h);
                        self.tensor[2 * n + i] =
                            sample(v, xx, yy, w, h) + dt * visc * laplacian(v, x, y, w, h);
                        self.tensor[i] = sample(&old[..n], xx, yy, w, h);
                    }
                }
                let mut divergence = vec![0.; n];
                for y in 0..h {
                    for x in 0..w {
                        let i = y * w + x;
                        let x = x as isize;
                        let y = y as isize;
                        divergence[i] = 0.5
                            * (self.tensor[n + index(x + 1, y, w, h)]
                                - self.tensor[n + index(x - 1, y, w, h)]
                                + self.tensor[2 * n + index(x, y + 1, w, h)]
                                - self.tensor[2 * n + index(x, y - 1, w, h)]);
                    }
                }
                let mut pressure = vec![0.; n];
                let mut next = vec![0.; n];
                for _ in 0..48 {
                    for y in 0..h {
                        for x in 0..w {
                            let i = y * w + x;
                            let x = x as isize;
                            let y = y as isize;
                            next[i] = (pressure[index(x - 1, y, w, h)]
                                + pressure[index(x + 1, y, w, h)]
                                + pressure[index(x, y - 1, w, h)]
                                + pressure[index(x, y + 1, w, h)]
                                - divergence[i])
                                * 0.25;
                        }
                    }
                    std::mem::swap(&mut pressure, &mut next);
                }
                for y in 0..h {
                    for x in 0..w {
                        let i = y * w + x;
                        let x = x as isize;
                        let y = y as isize;
                        self.tensor[n + i] -= 0.5
                            * (pressure[index(x + 1, y, w, h)] - pressure[index(x - 1, y, w, h)]);
                        self.tensor[2 * n + i] -= 0.5
                            * (pressure[index(x, y + 1, w, h)] - pressure[index(x, y - 1, w, h)]);
                        self.tensor[3 * n + i] = pressure[i];
                    }
                }
            }
            ensure!(self.tensor.iter().all(|x| x.is_finite()), "nonfinite field");
            self.tick += 1;
        }
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
        a.validate()?;
        let n = self.tensor.len() / 4;
        match a {
            Action::Paint { .. } => paint_grid(self.shape, a, |i, s| {
                let c = if self.gray { 3 * n + i } else { i };
                self.tensor[c] = (self.tensor[c] + s).clamp(0., 1.);
            })?,
            Action::Impulse {
                position,
                radius,
                vector,
            } => {
                ensure!(!self.gray, "Gray-Scott has no velocity field");
                let mask = Action::Paint {
                    position: *position,
                    radius: *radius,
                    strength: 1.,
                };
                paint_grid(self.shape, &mask, |i, _| {
                    self.tensor[n + i] += vector[0];
                    self.tensor[2 * n + i] += vector[1];
                })?;
            }
        }
        Ok(())
    }
}
