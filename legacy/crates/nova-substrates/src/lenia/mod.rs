//! Periodic 2D FFT Lenia with a normalized radial ring and Gaussian growth.
pub mod kernels;
use crate::*;
use rustfft::{num_complex::Complex32, Fft, FftPlanner};
use std::sync::Arc;
struct Plans {
    row: Arc<dyn Fft<f32>>,
    col: Arc<dyn Fft<f32>>,
    inverse_row: Arc<dyn Fft<f32>>,
    inverse_col: Arc<dyn Fft<f32>>,
}
impl Plans {
    fn transform(&self, data: &mut [Complex32], shape: [usize; 2], inverse: bool) {
        let [w, h] = shape;
        let row = if inverse {
            &self.inverse_row
        } else {
            &self.row
        };
        let col = if inverse {
            &self.inverse_col
        } else {
            &self.col
        };
        for chunk in data.chunks_mut(w) {
            row.process(chunk)
        }
        let mut column = vec![Complex32::default(); h];
        for x in 0..w {
            for y in 0..h {
                column[y] = data[y * w + x]
            }
            col.process(&mut column);
            for y in 0..h {
                data[y * w + x] = column[y]
            }
        }
        if inverse {
            let n = (w * h) as f32;
            for v in data {
                *v /= n;
            }
        }
    }
}
pub struct Lenia {
    shape: [usize; 2],
    mu: f32,
    sigma: f32,
    dt: f32,
    plans: Plans,
    kernel: Vec<Complex32>,
    tensor: Vec<f32>,
    tick: u64,
}
pub fn build(s: &EnvironmentSpec) -> Result<Box<dyn Substrate>> {
    let shape = grid_shape(s)?;
    let [w, h] = shape;
    let [mu, sigma, dt, radius] = s.parameters;
    ensure!(
        (0.0..=1.).contains(&mu) && sigma > 0. && sigma <= 1. && dt > 0. && dt <= 0.25,
        "invalid Lenia parameters"
    );
    let mut planner = FftPlanner::new();
    let plans = Plans {
        row: planner.plan_fft_forward(w),
        col: planner.plan_fft_forward(h),
        inverse_row: planner.plan_fft_inverse(w),
        inverse_col: planner.plan_fft_inverse(h),
    };
    let mut kernel: Vec<_> = kernels::ring(w, h, radius)?
        .into_iter()
        .map(|x| Complex32::new(x, 0.))
        .collect();
    plans.transform(&mut kernel, shape, false);
    let mut rng = nova_core::SplitMix64(s.seed);
    let mut tensor = vec![0.; 4 * w * h];
    for y in h / 4..3 * h / 4 {
        for x in w / 4..3 * w / 4 {
            tensor[y * w + x] = rng.unit();
        }
    }
    Ok(Box::new(Lenia {
        shape,
        mu,
        sigma,
        dt,
        plans,
        kernel,
        tensor,
        tick: 0,
    }))
}
impl Substrate for Lenia {
    fn time_step(&self) -> f32 {
        self.dt
    }
    fn name(&self) -> &'static str {
        "lenia"
    }
    fn step(&mut self, ticks: usize) -> Result<()> {
        ensure!(ticks <= 1_000_000, "tick budget");
        let n = self.kernel.len();
        for _ in 0..ticks {
            let mut field: Vec<_> = self.tensor[..n]
                .iter()
                .map(|&x| Complex32::new(x, 0.))
                .collect();
            self.plans.transform(&mut field, self.shape, false);
            for (x, k) in field.iter_mut().zip(&self.kernel) {
                *x *= k
            }
            self.plans.transform(&mut field, self.shape, true);
            for (i, x) in field.iter().enumerate() {
                let growth = 2. * (-0.5 * ((x.re - self.mu) / self.sigma).powi(2)).exp() - 1.;
                self.tensor[i] = (self.tensor[i] + self.dt * growth).clamp(0., 1.);
                self.tensor[3 * n + i] = growth;
            }
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
        paint_grid(self.shape, a, |i, s| {
            self.tensor[i] = (self.tensor[i] + s).clamp(0., 1.)
        })
    }
}
