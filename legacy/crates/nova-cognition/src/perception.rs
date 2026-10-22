//! V1-like edges and dorsal-like flow summary, no learned semantic claims.
use anyhow::{ensure, Result};
use nova_substrates::TensorView;
pub struct Features {
    pub vector: [f32; 16],
    pub focus: [f32; 3],
    pub mass: f32,
}
pub fn encode(view: TensorView<'_>) -> Result<Features> {
    ensure!(
        view.shape[0] == 4
            && view.shape.iter().try_fold(1usize, |a, &b| a.checked_mul(b))
                == Some(view.values.len())
            && !view.values.is_empty()
            && view.values.iter().all(|x| x.is_finite()),
        "invalid observer tensor"
    );
    let [_, d, h, w] = view.shape;
    let n = w * h * d;
    let density = &view.values[..n];
    let mass = density.iter().sum::<f32>() / n as f32;
    let variance = density.iter().map(|x| (x - mass).powi(2)).sum::<f32>() / n as f32;
    let mut vector = [0.; 16];
    vector[0] = mass.tanh();
    vector[1] = variance.sqrt().tanh();
    let mut centroid = [0.; 3];
    let mut sum = 0.;
    let mut edges = 0.;
    let mut peak = (0., [0.5; 3]);
    for z in 0..d {
        for y in 0..h {
            for x in 0..w {
                let i = (z * h + y) * w + x;
                let value = density[i].max(0.);
                let point = [
                    x as f32 / (w - 1).max(1) as f32,
                    y as f32 / (h - 1).max(1) as f32,
                    z as f32 / (d - 1).max(1) as f32,
                ];
                sum += value;
                for k in 0..3 {
                    centroid[k] += point[k] * value;
                }
                let edge = if x + 1 < w {
                    (density[i + 1] - density[i]).abs()
                } else {
                    0.
                } + if y + 1 < h {
                    (density[i + w] - density[i]).abs()
                } else {
                    0.
                };
                edges += edge;
                if edge > peak.0 {
                    peak = (edge, point);
                }
                let q = usize::from(x >= w / 2) + 2 * usize::from(y >= h / 2);
                vector[8 + q] += value / (n as f32 / 4.);
            }
        }
    }
    for k in 0..3 {
        centroid[k] /= sum.max(1e-8);
        vector[2 + k] = centroid[k] * 2. - 1.;
    }
    vector[5] = (edges / n as f32).tanh();
    vector[6] = (density.iter().filter(|&&x| x > 0.01).count() as f32 / n as f32).tanh();
    vector[7] = density
        .iter()
        .map(|x| if *x > 0. { -x * x.max(1e-8).ln() } else { 0. })
        .sum::<f32>()
        / n as f32;
    for k in 1..4 {
        vector[11 + k] = (view.values[k * n..(k + 1) * n].iter().sum::<f32>() / n as f32).tanh();
    }
    vector[15] = 1.;
    for x in &mut vector {
        *x = x.clamp(-1., 1.);
    }
    Ok(Features {
        vector,
        focus: if peak.0 > 0. { peak.1 } else { centroid },
        mass,
    })
}
