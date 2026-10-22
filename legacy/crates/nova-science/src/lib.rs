//! Finite observations and candidate equations, never automatic physical theorems.
use anyhow::{ensure, Result};
use nova_core::Particles;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Observables {
    pub mass: f64,
    pub kinetic: f64,
    pub momentum: [f64; 3],
    pub angular_momentum: [f64; 3],
    pub metabolic_energy: u64,
}
pub fn observe(p: &Particles) -> Observables {
    let mut o = Observables {
        mass: 0.,
        kinetic: 0.,
        momentum: [0.; 3],
        angular_momentum: [0.; 3],
        metabolic_energy: 0,
    };
    for i in 0..p.len() {
        let x = p.positions[i].0;
        let v = p.velocities[i].0;
        let m = v[3] as f64;
        o.mass += m;
        o.metabolic_energy += p.phenotypes[i][3] as u64;
        for k in 0..3 {
            o.kinetic += 0.5 * m * (v[k] as f64).powi(2);
            o.momentum[k] += m * v[k] as f64;
            o.angular_momentum[k] += m
                * (x[(k + 1) % 3] as f64 * v[(k + 2) % 3] as f64
                    - x[(k + 2) % 3] as f64 * v[(k + 1) % 3] as f64);
        }
    }
    o
}
#[derive(Clone, Debug, Serialize)]
pub struct Relevance {
    pub normalized_entropy: f64,
    pub occupied_cells: usize,
    pub h0_lifetimes: Vec<f32>,
    pub persistent_components: usize,
    pub accepted: bool,
    pub topology_scope: &'static str,
}
/// Exact H0 Vietoris-Rips death times on a stable, at-most-64-particle subsample.
/// Kruskal MST, not a claim to H1/H2 persistent homology of the full universe.
pub fn relevance(p: &Particles) -> Relevance {
    let mut bins = HashMap::new();
    for x in &p.positions {
        *bins
            .entry([
                (x.0[0] / 0.5).floor() as i32,
                (x.0[1] / 0.5).floor() as i32,
                (x.0[2] / 0.5).floor() as i32,
            ])
            .or_insert(0usize) += 1;
    }
    let entropy = bins
        .values()
        .map(|&n| {
            let q = n as f64 / p.len().max(1) as f64;
            -q * q.ln()
        })
        .sum::<f64>()
        / (p.len().max(2) as f64).ln();
    let mut order: Vec<_> = (0..p.len()).collect();
    order.sort_unstable_by_key(|&i| p.ids[i]);
    order.truncate(64);
    let mut edges = Vec::new();
    for i in 0..order.len() {
        for j in i + 1..order.len() {
            edges.push((
                nova_core::norm(nova_core::delta(
                    p.positions[order[i]].0,
                    p.positions[order[j]].0,
                )),
                i,
                j,
            ));
        }
    }
    edges.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut roots: Vec<_> = (0..order.len()).collect();
    fn root(r: &[usize], mut i: usize) -> usize {
        while r[i] != i {
            i = r[i];
        }
        i
    }
    let mut lifetimes = Vec::new();
    for (d, i, j) in edges {
        let a = root(&roots, i);
        let b = root(&roots, j);
        if a != b {
            roots[a] = b;
            lifetimes.push(d);
        }
    }
    let persistent = lifetimes.iter().filter(|&&x| x > 0.5 && x < 8.).count();
    Relevance {
        normalized_entropy: entropy,
        occupied_cells: bins.len(),
        persistent_components: persistent,
        accepted: p.len() > 1 && entropy > 0.05 && entropy < 0.98 && persistent > 0,
        h0_lifetimes: lifetimes,
        topology_scope: "H0 on <=64 stable IDs; no H1/H2 or scientific relevance guarantee",
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct Candidate {
    pub equation: String,
    pub coefficients: Vec<f64>,
    pub residual_rmse: f64,
    pub samples: usize,
    pub status: &'static str,
}
/// L1 coordinate descent on [1,x,y,z,vx,vy,vz], standardized by column RMS.
pub fn sparse_fit(x: &[[f64; 7]], y: &[f64], lambda: f64) -> Result<Candidate> {
    ensure!(
        !x.is_empty()
            && x.len() == y.len()
            && x.iter().flatten().chain(y).all(|v| v.is_finite())
            && lambda >= 0.
            && lambda.is_finite(),
        "invalid regression data"
    );
    let n = x.len() as f64;
    let mut scale = [1.; 7];
    for j in 0..7 {
        scale[j] = (x.iter().map(|r| r[j] * r[j]).sum::<f64>() / n)
            .sqrt()
            .max(1e-10);
    }
    let mut coefficients = [0.; 7];
    let mut residual = y.to_vec();
    for _ in 0..200 {
        for j in 0..7 {
            let old = coefficients[j];
            let rho = x
                .iter()
                .zip(&residual)
                .map(|(r, &v)| {
                    let a = r[j] / scale[j];
                    a * (v + a * old)
                })
                .sum::<f64>()
                / n;
            let denom = x.iter().map(|r| (r[j] / scale[j]).powi(2)).sum::<f64>() / n;
            let value = if j == 0 {
                rho
            } else {
                rho.signum() * (rho.abs() - lambda).max(0.)
            } / denom.max(1e-12);
            for (r, v) in x.iter().zip(&mut residual) {
                *v += (old - value) * r[j] / scale[j];
            }
            coefficients[j] = value;
        }
    }
    let coefficients: Vec<_> = coefficients.iter().zip(scale).map(|(c, s)| c / s).collect();
    let labels = ["1", "x", "y", "z", "vx", "vy", "vz"];
    let equation = coefficients
        .iter()
        .zip(labels)
        .filter(|(c, _)| c.abs() > 1e-9)
        .map(|(c, l)| format!("({c:0.9})*{l}"))
        .collect::<Vec<_>>()
        .join(" + ");
    Ok(Candidate {
        equation: format!("ax = {}", if equation.is_empty() { "0" } else { &equation }),
        coefficients,
        residual_rmse: (residual.iter().map(|v| v * v).sum::<f64>() / n).sqrt(),
        samples: x.len(),
        status: "candidate_not_verified",
    })
}
/// Lie derivative of I along f estimated by a centered directional difference.
pub fn lie_derivative(
    state: &[f64],
    field: &[f64],
    epsilon: f64,
    invariant: impl Fn(&[f64]) -> f64,
) -> Result<f64> {
    ensure!(
        state.len() == field.len()
            && epsilon.is_finite()
            && epsilon > 0.
            && state.iter().chain(field).all(|x| x.is_finite()),
        "invalid Lie audit input"
    );
    let plus: Vec<_> = state
        .iter()
        .zip(field)
        .map(|(x, f)| x + epsilon * f)
        .collect();
    let minus: Vec<_> = state
        .iter()
        .zip(field)
        .map(|(x, f)| x - epsilon * f)
        .collect();
    Ok((invariant(&plus) - invariant(&minus)) / (2. * epsilon))
}
pub fn lean_template() -> &'static str {
    r#"import Mathlib
-- This is an algebraic pair-impulse identity, not a proof of a simulated law.
-- Receipt remains pending until `lake env lean PairMomentum.lean` succeeds.
theorem pair_impulse_momentum (ma mb va vb impulse : ℝ)
    (ha : ma ≠ 0) (hb : mb ≠ 0) :
    ma * (va + impulse / ma) + mb * (vb - impulse / mb) = ma * va + mb * vb := by
  field_simp
  <;> ring
"#
}
