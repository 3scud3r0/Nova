//! Compact count/prefix/scatter grid; toroidal neighbors are deduplicated for 1/2 cells.
use crate::{Boundary, Settings};
use anyhow::{Result, ensure};
use nova_core::Particles;
pub struct Grid {
    pub offsets: Vec<usize>,
    pub order: Vec<usize>,
    dims: [usize; 3],
    half: [f32; 3],
    width: [f32; 3],
    periodic: bool,
    axes: usize,
}
impl Grid {
    pub fn build(p: &Particles, s: &Settings) -> Result<Self> {
        let cutoff = s.cutoff();
        let mut dims = [1; 3];
        let mut width = [1.; 3];
        for k in 0..s.dimensions {
            dims[k] = ((2. * s.half_extent[k] / cutoff).floor() as usize).max(1);
            width[k] = 2. * s.half_extent[k] / dims[k] as f32;
        }
        let cells = dims
            .iter()
            .try_fold(1usize, |a, &b| a.checked_mul(b))
            .ok_or_else(|| anyhow::anyhow!("grid size overflow"))?;
        ensure!(cells <= 8_000_000, "fusion grid cell budget exceeded");
        let mut grid = Self {
            offsets: vec![0; cells + 1],
            order: vec![0; p.len()],
            dims,
            half: s.half_extent,
            width,
            periodic: s.boundary == Boundary::Wrap,
            axes: s.dimensions,
        };
        // Nonperiodic open clouds must fit the declared index extent; never silently omit neighbors.
        ensure!(
            p.positions.iter().all(|p| (0..s.dimensions)
                .all(|k| p.0[k] >= -s.half_extent[k] && p.0[k] <= s.half_extent[k])),
            "cloud left fusion index extent; enlarge half_extent or use wrap/bounce"
        );
        for pos in &p.positions {
            let key = grid.key(grid.coord(pos.0));
            grid.offsets[key + 1] += 1;
        }
        for c in 1..=cells {
            grid.offsets[c] += grid.offsets[c - 1];
        }
        let mut cursor = grid.offsets[..cells].to_vec();
        for (i, pos) in p.positions.iter().enumerate() {
            let key = grid.key(grid.coord(pos.0));
            grid.order[cursor[key]] = i;
            cursor[key] += 1;
        }
        Ok(grid)
    }
    fn coord(&self, p: [f32; 4]) -> [usize; 3] {
        std::array::from_fn(|k| {
            if k < self.axes {
                (((p[k] + self.half[k]) / self.width[k]).floor() as usize).min(self.dims[k] - 1)
            } else {
                0
            }
        })
    }
    fn key(&self, c: [usize; 3]) -> usize {
        (c[2] * self.dims[1] + c[1]) * self.dims[0] + c[0]
    }
    pub fn candidates(&self, p: [f32; 4]) -> impl Iterator<Item = usize> + '_ {
        let c = self.coord(p);
        let mut keys = [usize::MAX; 27];
        let mut count = 0;
        for z in -1..=1 {
            if self.axes == 2 && z != 0 {
                continue;
            }
            for y in -1..=1 {
                for x in -1..=1 {
                    let mut q = [0; 3];
                    let offsets = [x, y, z];
                    let mut valid = true;
                    for k in 0..self.axes {
                        let v = c[k] as i64 + offsets[k];
                        if self.periodic {
                            q[k] = v.rem_euclid(self.dims[k] as i64) as usize;
                        } else if v < 0 || v >= self.dims[k] as i64 {
                            valid = false;
                            break;
                        } else {
                            q[k] = v as usize;
                        }
                    }
                    if valid {
                        let key = self.key(q);
                        if !keys[..count].contains(&key) {
                            keys[count] = key;
                            count += 1;
                        }
                    }
                }
            }
        }
        keys.into_iter()
            .take(count)
            .flat_map(|key| self.offsets[key]..self.offsets[key + 1])
            .map(|idx| self.order[idx])
    }
}
