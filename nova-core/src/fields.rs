//! Native SoA-compatible cell batches; no claim of FPS or power consumption.
use pyo3::{exceptions::PyValueError, prelude::*};
use rayon::prelude::*;
#[repr(C)]
#[derive(Clone, Copy, Default)]
#[cfg_attr(feature = "webgpu", derive(bytemuck::Pod, bytemuck::Zeroable))]
pub struct Cell {
    pub chem: [f32; 4],
    pub flow: [f32; 4],
    pub aux: [f32; 4],
}

#[pyclass]
pub struct NativeField {
    pub n: usize,
    pub cells: Vec<Cell>,
    pub ticks: u64,
}
#[pymethods]
impl NativeField {
    #[new]
    #[pyo3(signature=(n, chemistry, max_bytes=536870912))]
    fn new(n: usize, chemistry: Vec<f32>, max_bytes: usize) -> PyResult<Self> {
        if !(4..=256).contains(&n)
            || n.checked_pow(3)
                .and_then(|x| x.checked_mul(144))
                .is_none_or(|bytes| bytes > max_bytes)
            || chemistry.len() != 2 * n * n * n
            || chemistry
                .iter()
                .any(|x| !x.is_finite() || *x < 0. || *x > 1.)
        {
            return Err(PyValueError::new_err(
                "invalid field dimensions/state/memory budget",
            ));
        }
        let cells = chemistry
            .chunks_exact(2)
            .map(|x| Cell {
                chem: [x[0], x[1], 0., 0.],
                ..Cell::default()
            })
            .collect();
        Ok(Self { n, cells, ticks: 0 })
    }
    #[pyo3(signature=(steps=1,dt=0.1,feed=0.035,kill=0.065,du=0.16,dv=0.08,viscosity=0.02,speed=1.,damping=0.02,fluid=false,pressure_iterations=32))]
    #[allow(clippy::too_many_arguments)]
    fn step(
        &mut self,
        py: Python<'_>,
        steps: usize,
        dt: f32,
        feed: f32,
        kill: f32,
        du: f32,
        dv: f32,
        viscosity: f32,
        speed: f32,
        damping: f32,
        fluid: bool,
        pressure_iterations: usize,
    ) -> PyResult<()> {
        validate(
            steps,
            dt,
            &[feed, kill, du, dv, viscosity, speed, damping],
            pressure_iterations,
        )?;
        py.allow_threads(|| {
            for _ in 0..steps {
                self.cells = cpu_stage(
                    &self.cells,
                    self.n,
                    0,
                    dt,
                    [feed, kill, du, dv, viscosity, speed, damping],
                );
                if fluid {
                    for stage in [1, 2] {
                        self.cells = cpu_stage(
                            &self.cells,
                            self.n,
                            stage,
                            dt,
                            [feed, kill, du, dv, viscosity, speed, damping],
                        );
                    }
                    for _ in 0..pressure_iterations {
                        self.cells = cpu_stage(
                            &self.cells,
                            self.n,
                            3,
                            dt,
                            [feed, kill, du, dv, viscosity, speed, damping],
                        );
                    }
                    self.cells = cpu_stage(
                        &self.cells,
                        self.n,
                        4,
                        dt,
                        [feed, kill, du, dv, viscosity, speed, damping],
                    );
                }
                self.ticks += 1;
            }
        });
        Ok(())
    }
    fn snapshot(&self) -> (Vec<f32>, Vec<f32>, Vec<f32>, u64) {
        snapshot(&self.cells, self.ticks)
    }
    fn inject(&mut self, index: usize, velocity: [f32; 3], signal: f32) -> PyResult<()> {
        if index >= self.cells.len()
            || velocity.iter().any(|v| !v.is_finite() || v.abs() > 10.)
            || !signal.is_finite()
            || signal.abs() > 1.
        {
            return Err(PyValueError::new_err("invalid injection"));
        }
        self.cells[index].flow[..3].copy_from_slice(&velocity);
        self.cells[index].chem[3] += signal;
        Ok(())
    }
}
pub fn snapshot(cells: &[Cell], tick: u64) -> (Vec<f32>, Vec<f32>, Vec<f32>, u64) {
    (
        cells
            .iter()
            .flat_map(|c| c.chem[..2].iter().copied())
            .collect(),
        cells
            .iter()
            .flat_map(|c| c.flow[..3].iter().copied())
            .collect(),
        cells.iter().map(|c| c.chem[2]).collect(),
        tick,
    )
}
pub fn validate(steps: usize, dt: f32, params: &[f32], pressure: usize) -> PyResult<()> {
    if !(1..=1024).contains(&steps)
        || !dt.is_finite()
        || dt <= 0.
        || dt > 0.1
        || params.iter().any(|v| !v.is_finite() || *v < 0. || *v > 1.)
        || 6. * params[2].max(params[3]).max(params[4]) * dt > 0.5
        || dt * params[5] * 3_f32.sqrt() > 0.5
        || !(1..=256).contains(&pressure)
    {
        return Err(PyValueError::new_err(
            "field stability/iteration budget exceeded",
        ));
    }
    Ok(())
}
fn cpu_stage(src: &[Cell], n: usize, stage: u32, dt: f32, v: [f32; 7]) -> Vec<Cell> {
    (0..src.len())
        .into_par_iter()
        .map(|i| {
            let p = [i % n, (i / n) % n, i / (n * n)];
            let idx = |q: [isize; 3]| {
                let x = q[0].rem_euclid(n as isize) as usize;
                let y = q[1].rem_euclid(n as isize) as usize;
                let z = q[2].rem_euclid(n as isize) as usize;
                (z * n + y) * n + x
            };
            let p = p.map(|x| x as isize);
            let c = src[i];
            let mut out = c;
            let mut plus = [Cell::default(); 3];
            let mut minus = plus;
            for a in 0..3 {
                let mut q = p;
                q[a] += 1;
                plus[a] = src[idx(q)];
                q[a] -= 2;
                minus[a] = src[idx(q)];
            }
            match stage {
                0 => {
                    let mut lap = [0.; 4];
                    for (j, l) in lap.iter_mut().enumerate() {
                        *l = (0..3)
                            .map(|a| plus[a].chem[j] + minus[a].chem[j])
                            .sum::<f32>()
                            - 6. * c.chem[j];
                    }
                    let r = c.chem[0] * c.chem[1] * c.chem[1];
                    out.chem[0] = (c.chem[0] + dt * (v[2] * lap[0] - r + v[0] * (1. - c.chem[0])))
                        .clamp(0., 1.);
                    out.chem[1] = (c.chem[1]
                        + dt * (v[3] * lap[1] + r - (v[0] + v[1]) * c.chem[1]))
                        .clamp(0., 1.);
                    out.chem[3] += dt * (v[5] * v[5] * lap[2] - v[6] * c.chem[3]);
                    out.chem[2] += dt * out.chem[3];
                }
                1 => {
                    let q = [
                        p[0] as f32 - dt * c.flow[0],
                        p[1] as f32 - dt * c.flow[1],
                        p[2] as f32 - dt * c.flow[2],
                    ];
                    let lo = q.map(|x| x.floor() as isize);
                    let f = q.map(|x| x - x.floor());
                    out.flow = [0.; 4];
                    for z in 0..2 {
                        for y in 0..2 {
                            for x in 0..2 {
                                let d = [x, y, z];
                                let w = (0..3)
                                    .map(|a| if d[a] == 1 { f[a] } else { 1. - f[a] })
                                    .product::<f32>();
                                let cell = src[idx([lo[0] + x, lo[1] + y, lo[2] + z])];
                                for j in 0..4 {
                                    out.flow[j] += w * cell.flow[j];
                                }
                            }
                        }
                    }
                    for j in 0..4 {
                        out.flow[j] += dt
                            * v[4]
                            * ((0..3)
                                .map(|a| plus[a].flow[j] + minus[a].flow[j])
                                .sum::<f32>()
                                - 6. * c.flow[j]);
                    }
                }
                2 => {
                    out.aux[0] = 0.;
                    out.aux[1] = (0..3).map(|a| c.flow[a] - minus[a].flow[a]).sum::<f32>() / dt;
                }
                3 => {
                    out.aux[0] = ((0..3)
                        .map(|a| plus[a].aux[0] + minus[a].aux[0])
                        .sum::<f32>()
                        - c.aux[1])
                        / 6.
                }
                4 => {
                    for a in 0..3 {
                        out.flow[a] -= dt * (plus[a].aux[0] - c.aux[0]);
                    }
                }
                _ => (),
            };
            out
        })
        .collect()
}
