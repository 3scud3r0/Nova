#[path = "conway_simd.rs"]
mod simd;
// Periodic, exact B/S automata. 2D uses 64 cells per word and bit-sliced counts.
use anyhow::{ensure, Result};
use nova_core::SplitMix64;
#[derive(Clone, Copy, Debug)]
pub struct Rule {
    pub birth: u32,
    pub survive: u32,
}
impl Rule {
    pub fn parse(s: &str) -> Result<Self> {
        let parts: Vec<_> = s.split('/').collect();
        ensure!(
            parts.len() == 2 && parts[0].starts_with('B') && parts[1].starts_with('S'),
            "expected B3/S23 or B6/S5,6,7"
        );
        fn mask(s: &str) -> Result<u32> {
            let values: Vec<u32> = if s.contains(',') {
                s.split(',')
                    .map(str::parse)
                    .collect::<std::result::Result<_, _>>()?
            } else {
                s.chars()
                    .map(|c| {
                        c.to_digit(10)
                            .ok_or_else(|| anyhow::anyhow!("invalid rule"))
                    })
                    .collect::<Result<_>>()?
            };
            ensure!(values.iter().all(|&x| x <= 26), "neighbor count exceeds 26");
            Ok(values.into_iter().fold(0, |a, x| a | (1 << x)))
        }
        Ok(Self {
            birth: mask(&parts[0][1..])?,
            survive: mask(&parts[1][1..])?,
        })
    }
}
pub struct Conway {
    pub width: usize,
    pub height: usize,
    pub words: Vec<u64>,
    pub rule: Rule,
    pub tick: u64,
}
impl Conway {
    pub fn new(width: usize, height: usize, rule: Rule, seed: u64) -> Result<Self> {
        ensure!(
            width >= 64
                && width % 64 == 0
                && height >= 3
                && width.checked_mul(height).is_some_and(|n| n <= 1 << 30),
            "grid needs width multiple of 64, height >=3, <=2^30 cells"
        );
        ensure!(
            rule.birth < 512 && rule.survive < 512,
            "2D counts must be <=8"
        );
        let mut rng = SplitMix64(seed);
        let words = (0..width / 64 * height)
            .map(|_| rng.next_u64() & rng.next_u64())
            .collect();
        Ok(Self {
            width,
            height,
            words,
            rule,
            tick: 0,
        })
    }
    pub fn step(&mut self) {
        use rayon::prelude::*;
        let stride = self.width / 64;
        let rows = self.height;
        let old = &self.words;
        let rule = self.rule;
        let mut next = vec![0; old.len()];
        next.par_chunks_mut(stride)
            .enumerate()
            .for_each(|(y, row)| {
                for (block, chunk) in row.chunks_mut(4).enumerate() {
                    let mut neighbors = [[0u64; 4]; 8];
                    let mut current = [0u64; 4];
                    for lane in 0..chunk.len() {
                        let x = block * 4 + lane;
                        current[lane] = old[y * stride + x];
                        let mut n = 0;
                        for yy in [(y + rows - 1) % rows, y, (y + 1) % rows] {
                            let center = old[yy * stride + x];
                            neighbors[n][lane] = (center << 1)
                                | (old[yy * stride + (x + stride - 1) % stride] >> 63);
                            n += 1;
                            if yy != y {
                                neighbors[n][lane] = center;
                                n += 1;
                            }
                            neighbors[n][lane] =
                                (center >> 1) | (old[yy * stride + (x + 1) % stride] << 63);
                            n += 1;
                        }
                    }
                    let result = simd::transition(neighbors, current, rule.birth, rule.survive);
                    chunk.copy_from_slice(&result[..chunk.len()]);
                }
            });
        self.words = next;
        self.tick += 1;
    }
    pub fn population(&self) -> u64 {
        self.words.iter().map(|x| x.count_ones() as u64).sum()
    }
}
/// Separate integer Moore-26 implementation; this is not the 2D Conway rule.
pub fn step_3d(old: &[u8], shape: [usize; 3], rule: Rule) -> Result<Vec<u8>> {
    ensure!(
        shape.iter().all(|&n| n >= 3)
            && shape.iter().try_fold(1usize, |a, &b| a.checked_mul(b)) == Some(old.len())
            && old.iter().all(|&x| x <= 1),
        "invalid 3D boolean grid"
    );
    let [nx, ny, nz] = shape;
    let mut new = vec![0; old.len()];
    for x in 0..nx {
        for y in 0..ny {
            for z in 0..nz {
                let mut count = 0;
                for dx in [-1isize, 0, 1] {
                    for dy in [-1isize, 0, 1] {
                        for dz in [-1isize, 0, 1] {
                            if dx == 0 && dy == 0 && dz == 0 {
                                continue;
                            }
                            let ix = (x as isize + dx).rem_euclid(nx as isize) as usize;
                            let iy = (y as isize + dy).rem_euclid(ny as isize) as usize;
                            let iz = (z as isize + dz).rem_euclid(nz as isize) as usize;
                            count += old[(ix * ny + iy) * nz + iz] as u32;
                        }
                    }
                }
                let i = (x * ny + y) * nz + z;
                new[i] = (((if old[i] == 1 {
                    rule.survive
                } else {
                    rule.birth
                }) >> count)
                    & 1) as u8;
            }
        }
    }
    Ok(new)
}
