use anyhow::{ensure, Result};
pub fn ring(width: usize, height: usize, radius: f32) -> Result<Vec<f32>> {
    ensure!(
        radius.is_finite() && radius >= 1. && radius <= width.min(height) as f32 / 2.,
        "invalid Lenia radius"
    );
    let mut kernel = vec![0.; width * height];
    for y in 0..height {
        for x in 0..width {
            let dx = x.min(width - x) as f32;
            let dy = y.min(height - y) as f32;
            let q = (dx * dx + dy * dy).sqrt() / radius;
            if q < 1. {
                kernel[y * width + x] = (-0.5 * ((q - 0.5) / 0.15).powi(2)).exp();
            }
        }
    }
    let sum = kernel.iter().sum::<f32>();
    ensure!(sum > 0., "empty kernel");
    for v in &mut kernel {
        *v /= sum;
    }
    Ok(kernel)
}
