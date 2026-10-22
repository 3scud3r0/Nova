//! Native RK4 ports of the four initial realethersim strange-attractor systems (MIT).
use anyhow::{Result, ensure};
use rayon::prelude::*;
#[derive(Clone, Copy)]
pub enum Attractor {
    Lorenz,
    Rossler,
    Aizawa,
    Thomas,
}
impl Attractor {
    pub fn derivative(self, [x, y, z]: [f64; 3]) -> [f64; 3] {
        match self {
            Self::Lorenz => [10. * (y - x), x * (28. - z) - y, x * y - 8. / 3. * z],
            Self::Rossler => [-y - z, x + 0.2 * y, 0.2 + z * (x - 5.7)],
            Self::Aizawa => [
                (z - 0.7) * x - 3.5 * y,
                3.5 * x + (z - 0.7) * y,
                0.6 + 0.95 * z - z * z * z / 3. - (x * x + y * y) * (1. + 0.25 * z)
                    + 0.1 * z * x * x * x,
            ],
            Self::Thomas => [y.sin() - 0.19 * x, z.sin() - 0.19 * y, x.sin() - 0.19 * z],
        }
    }
    pub fn step(self, states: &mut [[f64; 3]], dt: f64) -> Result<()> {
        ensure!(
            dt.is_finite()
                && dt > 0.
                && dt <= 0.05
                && states.iter().flatten().all(|x| x.is_finite()),
            "invalid RK4 input"
        );
        states.par_iter_mut().for_each(|x| {
            let k1 = self.derivative(*x);
            let k2 = self.derivative(std::array::from_fn(|i| x[i] + 0.5 * dt * k1[i]));
            let k3 = self.derivative(std::array::from_fn(|i| x[i] + 0.5 * dt * k2[i]));
            let k4 = self.derivative(std::array::from_fn(|i| x[i] + dt * k3[i]));
            for i in 0..3 {
                x[i] += dt * (k1[i] + 2. * k2[i] + 2. * k3[i] + k4[i]) / 6.;
            }
        });
        ensure!(
            states.iter().flatten().all(|x| x.is_finite()),
            "attractor became nonfinite"
        );
        Ok(())
    }
}
