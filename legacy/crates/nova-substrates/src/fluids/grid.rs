//! Periodic grid operators. Units are grid cells and solver time units.
pub fn index(x: isize, y: isize, w: usize, h: usize) -> usize {
    y.rem_euclid(h as isize) as usize * w + x.rem_euclid(w as isize) as usize
}
pub fn laplacian(v: &[f32], x: usize, y: usize, w: usize, h: usize) -> f32 {
    let x = x as isize;
    let y = y as isize;
    v[index(x - 1, y, w, h)]
        + v[index(x + 1, y, w, h)]
        + v[index(x, y - 1, w, h)]
        + v[index(x, y + 1, w, h)]
        - 4. * v[index(x, y, w, h)]
}
pub fn sample(v: &[f32], x: f32, y: f32, w: usize, h: usize) -> f32 {
    let x0 = x.floor() as isize;
    let y0 = y.floor() as isize;
    let a = x - x.floor();
    let b = y - y.floor();
    (1. - b) * ((1. - a) * v[index(x0, y0, w, h)] + a * v[index(x0 + 1, y0, w, h)])
        + b * ((1. - a) * v[index(x0, y0 + 1, w, h)] + a * v[index(x0 + 1, y0 + 1, w, h)])
}
