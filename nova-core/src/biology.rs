//! Rayon batches; compiler may vectorize, but no AVX-512/Neon throughput claim.
use pyo3::{exceptions::PyValueError, prelude::*};
use rayon::prelude::*;
#[pyfunction]
pub fn cppn_batch(
    py: Python<'_>,
    features: Vec<Vec<f64>>,
    w_in: Vec<f64>,
    layers: Vec<Vec<f64>>,
    biases: Vec<Vec<f64>>,
    kinds: Vec<Vec<u8>>,
    w_out: Vec<f64>,
    width: usize,
) -> PyResult<Vec<Vec<f64>>> {
    if !(4..=64).contains(&width)
        || features.len() > 262144
        || features
            .iter()
            .any(|p| p.len() != 8 || p.iter().any(|x| !x.is_finite() || x.abs() > 1e6))
        || w_in.len() != 8 * width
        || w_out.len() != 8 * width
        || layers.is_empty()
        || layers.len() > 6
        || layers.len() != biases.len()
        || layers.len() != kinds.len()
        || layers.iter().any(|w| w.len() != width * width)
        || biases.iter().any(|b| b.len() != width)
        || kinds
            .iter()
            .any(|k| k.len() != width || k.iter().any(|v| *v > 4))
        || w_in
            .iter()
            .chain(w_out.iter())
            .chain(layers.iter().flatten())
            .chain(biases.iter().flatten())
            .any(|v| !v.is_finite() || v.abs() > 100.)
    {
        return Err(PyValueError::new_err("invalid CPPN arrays/budget"));
    }
    Ok(py.allow_threads(|| {
        features
            .par_iter()
            .map(|point| {
                let mut h: Vec<f64> = (0..width)
                    .map(|j| {
                        (0..8)
                            .map(|i| point[i] * w_in[i * width + j])
                            .sum::<f64>()
                            .tanh()
                    })
                    .collect();
                for depth in 0..layers.len() {
                    h = (0..width)
                        .map(|j| {
                            let x = (h
                                .iter()
                                .enumerate()
                                .map(|(i, a)| a * layers[depth][i * width + j])
                                .sum::<f64>()
                                + biases[depth][j])
                                .clamp(-20., 20.);
                            match kinds[depth][j] {
                                0 => x.sin(),
                                1 => x.tanh(),
                                2 => (-x * x).exp(),
                                3 => x.abs(),
                                _ => x,
                            }
                        })
                        .collect();
                }
                (0..8)
                    .map(|j| {
                        h.iter()
                            .enumerate()
                            .map(|(i, a)| a * w_out[i * 8 + j])
                            .sum::<f64>()
                            .tanh()
                    })
                    .collect()
            })
            .collect()
    }))
}
fn ratio(x: f64) -> f64 {
    if x.abs() < 1e-7 {
        1.
    } else {
        x / (-(-x).exp_m1())
    }
}
fn derivative(s: &[f64; 6], current: f64) -> [f64; 6] {
    let v = s[0];
    let am = ratio((v + 40.) / 10.);
    let bm = 4. * (-(v + 65.) / 18.).exp();
    let ah = 0.07 * (-(v + 65.) / 20.).exp();
    let bh = 1. / (1. + (-(v + 35.) / 10.).exp());
    let an = 0.1 * ratio((v + 55.) / 10.);
    let bn = 0.125 * (-(v + 65.) / 80.).exp();
    let steady = [
        am / (am + bm),
        ah / (ah + bh),
        an / (an + bn),
        1. / (1. + (-(v + 20.) / 6.).exp()),
        1. / (1. + ((v + 80.) / 8.).exp()),
    ];
    let tau = [1. / (am + bm), 1. / (ah + bh), 1. / (an + bn), 5., 100.];
    let ionic = 120. * s[1].powi(3) * s[2] * (v - 50.)
        + 36. * s[3].powi(4) * (v + 77.)
        + 0.05 * s[4] * s[4] * (v - 120.)
        + 0.02 * s[5] * (v + 20.)
        + 0.3 * (v + 54.4);
    let mut out = [0.; 6];
    out[0] = current - ionic;
    for i in 0..5 {
        out[i + 1] = (steady[i] - s[i + 1]) / tau[i];
    }
    out
}
#[pyfunction]
pub fn hh_batch(
    py: Python<'_>,
    state: Vec<Vec<f64>>,
    currents: Vec<f64>,
    dt: f64,
) -> PyResult<Vec<Vec<f64>>> {
    if state.is_empty()
        || state.len() > 100000
        || state.len() != currents.len()
        || !dt.is_finite()
        || dt <= 0.
        || dt > 0.05
        || state.iter().any(|s| {
            s.len() != 6
                || s.iter().any(|v| !v.is_finite())
                || !(-150. ..=100.).contains(&s[0])
                || s[1..].iter().any(|v| !(0. ..=1.).contains(v))
        })
        || currents.iter().any(|v| !v.is_finite() || v.abs() > 100.)
    {
        return Err(PyValueError::new_err(
            "invalid independent HH state/current/time budget",
        ));
    }
    let result: Vec<Vec<f64>> = py.allow_threads(|| {
        state
            .par_iter()
            .zip(currents.par_iter())
            .map(|(row, current)| {
                let s: [f64; 6] = row.as_slice().try_into().unwrap();
                let add =
                    |k: [f64; 6], scale: f64| std::array::from_fn(|i| s[i] + dt * scale * k[i]);
                let k1 = derivative(&s, *current);
                let k2 = derivative(&add(k1, 0.5), *current);
                let k3 = derivative(&add(k2, 0.5), *current);
                let k4 = derivative(&add(k3, 1.), *current);
                (0..6)
                    .map(|i| s[i] + dt * (k1[i] + 2. * k2[i] + 2. * k3[i] + k4[i]) / 6.)
                    .collect()
            })
            .collect()
    });
    if result.iter().flatten().any(|x| !x.is_finite()) {
        return Err(PyValueError::new_err("nonfinite HH output"));
    }
    Ok(result)
}
