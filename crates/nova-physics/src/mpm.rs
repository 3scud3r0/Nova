//! Sparse, open-grid 3D APIC/MLS-MPM liquid. Explicit EOS, no wall projection.
use anyhow::{ensure, Result};
use nova_core::{norm, Particles};
use std::collections::HashMap;
#[derive(Clone, Copy, Default)]
struct Node {
    mass: f32,
    v: [f32; 3],
}
pub struct Mpm {
    pub dx: f32,
    pub dt: f32,
    pub bulk: f32,
    pub viscosity: f32,
    pub gravity: [f32; 3],
    pub density: f32,
    affine: Vec<[[f32; 3]; 3]>,
    volume_ratio: Vec<f32>,
}
impl Mpm {
    pub fn new(n: usize) -> Self {
        Self {
            dx: 0.25,
            dt: 0.001,
            bulk: 20.,
            viscosity: 0.05,
            gravity: [0., -0.1, 0.],
            density: 1.,
            affine: vec![[[0.; 3]; 3]; n],
            volume_ratio: vec![1.; n],
        }
    }
    pub fn step(&mut self, p: &mut Particles) -> Result<()> {
        p.validate()?;
        ensure!(
            p.len() == self.affine.len(),
            "MPM particle membership changed"
        );
        ensure!(
            [self.dx, self.dt, self.bulk, self.viscosity, self.density]
                .iter()
                .all(|x| x.is_finite())
                && self.dx > 0.
                && self.dt > 0.
                && self.bulk > 0.
                && self.viscosity >= 0.
                && self.density > 0.,
            "invalid MPM coefficients"
        );
        let maxv = p
            .velocities
            .iter()
            .map(|x| norm([x.0[0], x.0[1], x.0[2]]))
            .fold(0., f32::max);
        ensure!(
            self.dt * ((4. * self.bulk / self.density).sqrt() + maxv) / self.dx <= 0.4,
            "MPM CFL exceeded; reduce dt"
        );
        let mut grid: HashMap<[i32; 3], Node> = HashMap::new();
        for i in 0..p.len() {
            let x = p.positions[i].0;
            let v = p.velocities[i].0;
            let j = self.volume_ratio[i];
            ensure!(j > 0.1 && j < 10., "MPM volume ratio unstable; reduce dt");
            let pressure = self.bulk * (j.powi(-4) - 1.);
            let volume = v[3] / self.density;
            let mut a = [[0.; 3]; 3];
            for k in 0..3 {
                for l in 0..3 {
                    let stress = if k == l { -pressure } else { 0. }
                        + self.viscosity * (self.affine[i][k][l] + self.affine[i][l][k]);
                    a[k][l] = v[3] * self.affine[i][k][l]
                        - self.dt * volume * 4. / (self.dx * self.dx) * stress;
                }
            }
            for (key, w, d) in stencil(x, self.dx)? {
                let node = grid.entry(key).or_default();
                node.mass += w * v[3];
                for k in 0..3 {
                    node.v[k] += w * (v[3] * v[k] + (0..3).map(|l| a[k][l] * d[l]).sum::<f32>());
                }
            }
        }
        for node in grid.values_mut() {
            if node.mass > 0. {
                for k in 0..3 {
                    node.v[k] = node.v[k] / node.mass + self.dt * self.gravity[k];
                }
            }
        }
        let mut positions = p.positions.clone();
        let mut velocities = p.velocities.clone();
        let mut affine = self.affine.clone();
        let mut ratios = self.volume_ratio.clone();
        for i in 0..p.len() {
            let mut v = [0.; 3];
            let mut a = [[0.; 3]; 3];
            for (key, w, d) in stencil(p.positions[i].0, self.dx)? {
                let node = &grid[&key];
                for k in 0..3 {
                    v[k] += w * node.v[k];
                    for l in 0..3 {
                        a[k][l] += 4. / (self.dx * self.dx) * w * node.v[k] * d[l];
                    }
                }
            }
            let ratio = self.volume_ratio[i] * (1. + self.dt * (a[0][0] + a[1][1] + a[2][2]));
            ensure!(
                ratio.is_finite() && ratio > 0.1 && ratio < 10. && v.iter().all(|x| x.is_finite()),
                "MPM unstable step"
            );
            for k in 0..3 {
                positions[i].0[k] += self.dt * v[k];
                velocities[i].0[k] = v[k];
            }
            affine[i] = a;
            ratios[i] = ratio;
        }
        p.positions = positions;
        p.velocities = velocities;
        self.affine = affine;
        self.volume_ratio = ratios;
        p.validate()
    }
}
fn stencil(x: [f32; 4], dx: f32) -> Result<Vec<([i32; 3], f32, [f32; 3])>> {
    let q = [x[0] / dx, x[1] / dx, x[2] / dx];
    ensure!(
        q.iter().all(|x| x.is_finite() && x.abs() < 1_000_000.),
        "MPM spatial range exceeded"
    );
    let base = q.map(|x| (x - 0.5).floor() as i32);
    let f = [
        q[0] - base[0] as f32,
        q[1] - base[1] as f32,
        q[2] - base[2] as f32,
    ];
    let w = f.map(|x| {
        [
            0.5 * (1.5 - x).powi(2),
            0.75 - (x - 1.).powi(2),
            0.5 * (x - 0.5).powi(2),
        ]
    });
    let mut out = Vec::with_capacity(27);
    for i in 0..3 {
        for j in 0..3 {
            for k in 0..3 {
                out.push((
                    [base[0] + i as i32, base[1] + j as i32, base[2] + k as i32],
                    w[0][i] * w[1][j] * w[2][k],
                    [
                        (i as f32 - f[0]) * dx,
                        (j as f32 - f[1]) * dx,
                        (k as f32 - f[2]) * dx,
                    ],
                ));
            }
        }
    }
    Ok(out)
}
