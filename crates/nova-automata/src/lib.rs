//! Native integer cellular automata: 2D Moore radius 1/2, 3D Moore-26.
//! Evolution/topology ports based on licensed references; no browser dependencies.
pub mod analysis;
pub mod patterns;
pub mod rle;
use anyhow::{ensure, Result};
use nova_core::SplitMix64;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::Path,
};
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Boundary {
    Periodic,
    Dead,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rules {
    pub birth: u32,
    pub survival: u32,
    pub radius: u32,
    pub dimensions: u32,
}
impl Rules {
    pub fn max_neighbors(self) -> u32 {
        if self.dimensions == 3 {
            26
        } else {
            (2 * self.radius + 1).pow(2) - 1
        }
    }
    pub fn validate(self) -> Result<()> {
        ensure!(
            matches!((self.dimensions, self.radius), (2, 1) | (2, 2) | (3, 1)),
            "supported neighborhoods: 2D radius 1/2, 3D radius 1"
        );
        let bits = (1u32 << (self.max_neighbors() + 1)) - 1;
        ensure!(
            self.birth & !bits == 0 && self.survival & !bits == 0,
            "rule count outside neighborhood"
        );
        Ok(())
    }
    pub fn parse(text: &str, dimensions: u32, radius: u32) -> Result<Self> {
        let parts: Vec<_> = text.split('/').collect();
        ensure!(
            parts.len() == 2 || parts.len() == 3,
            "expected B.../S...[/R1|R2]"
        );
        let radius = if parts.len() == 3 {
            parts[2]
                .strip_prefix('R')
                .ok_or_else(|| anyhow::anyhow!("invalid radius suffix"))?
                .parse()?
        } else {
            radius
        };
        let mut rule = Self {
            birth: 0,
            survival: 0,
            dimensions,
            radius,
        };
        rule.validate()?;
        let max = rule.max_neighbors();
        fn counts(text: &str, max: u32) -> Result<u32> {
            if text == "*" {
                return Ok((1u32 << (max + 1)) - 1);
            }
            let explicit = text.starts_with('{') && text.ends_with('}');
            let text = if explicit {
                &text[1..text.len() - 1]
            } else {
                text
            };
            let mut values = Vec::new();
            if text.contains(',') || text.contains('-') || explicit {
                for piece in text.split(',').filter(|x| !x.is_empty()) {
                    if let Some((a, b)) = piece.split_once('-') {
                        let a: u32 = a.parse()?;
                        let b: u32 = b.parse()?;
                        ensure!(a <= b && b <= max, "invalid neighbor range");
                        values.extend(a..=b);
                    } else {
                        values.push(piece.parse()?);
                    }
                }
            } else {
                for ch in text.chars() {
                    values.push(
                        ch.to_digit(10)
                            .ok_or_else(|| anyhow::anyhow!("invalid neighbor count"))?,
                    );
                }
            }
            ensure!(
                values.iter().all(|&x| x <= max),
                "neighbor count exceeds {max}"
            );
            Ok(values.into_iter().fold(0, |a, n| a | (1 << n)))
        }
        rule.birth = counts(
            parts[0]
                .strip_prefix('B')
                .ok_or_else(|| anyhow::anyhow!("missing B prefix"))?,
            max,
        )?;
        rule.survival = counts(
            parts[1]
                .strip_prefix('S')
                .ok_or_else(|| anyhow::anyhow!("missing S prefix"))?,
            max,
        )?;
        rule.validate()?;
        Ok(rule)
    }
    pub fn preset(name: &str) -> Result<Self> {
        let (s, r) = match name {
            "conway" => ("B3/S23", 1),
            "highlife" => ("B36/S23", 1),
            "day-night" => ("B3678/S34678", 1),
            "seeds" => ("B2/S", 1),
            "life-without-death" => ("B3/S*", 1),
            "bugs" => ("B3-5/S4-8", 2),
            "globe" => ("B7-11/S7-11", 2),
            "majority" => ("B5-8/S4-10", 2),
            _ => anyhow::bail!("unknown rule preset"),
        };
        Self::parse(s, 2, r)
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Grid {
    pub shape: [usize; 3],
    pub rules: Rules,
    pub boundary: Boundary,
    pub tick: u64,
    pub cells: Vec<u8>,
}
impl Grid {
    pub fn new(shape: [usize; 3], rules: Rules, boundary: Boundary) -> Result<Self> {
        rules.validate()?;
        let minimum = (2 * rules.radius + 1) as usize;
        ensure!(
            shape[0] >= minimum
                && shape[1] >= minimum
                && if rules.dimensions == 2 {
                    shape[2] == 1
                } else {
                    shape[2] >= minimum
                },
            "shape incompatible with neighborhood"
        );
        let size = shape
            .iter()
            .try_fold(1usize, |a, &b| a.checked_mul(b))
            .ok_or_else(|| anyhow::anyhow!("grid size overflow"))?;
        ensure!(size <= 16_777_216, "native CA cell budget is 2^24");
        Ok(Self {
            shape,
            rules,
            boundary,
            tick: 0,
            cells: vec![0; size],
        })
    }
    pub fn randomize(&mut self, seed: u64, density: f32) -> Result<()> {
        ensure!(
            density.is_finite() && (0.0..=1.).contains(&density),
            "invalid density"
        );
        let mut rng = SplitMix64(seed);
        for cell in &mut self.cells {
            *cell = (rng.unit() < density) as u8;
        }
        self.tick = 0;
        Ok(())
    }
    pub fn validate(&self) -> Result<()> {
        let expected = Self::new(self.shape, self.rules, self.boundary)?;
        ensure!(
            expected.cells.len() == self.cells.len() && self.cells.iter().all(|&x| x <= 1),
            "invalid binary grid"
        );
        Ok(())
    }
    fn offset(&self, mut p: [isize; 3]) -> Option<usize> {
        for (k, x) in p.iter_mut().enumerate() {
            if self.boundary == Boundary::Periodic {
                *x = x.rem_euclid(self.shape[k] as isize);
            } else if *x < 0 || *x >= self.shape[k] as isize {
                return None;
            }
        }
        Some((p[2] as usize * self.shape[1] + p[1] as usize) * self.shape[0] + p[0] as usize)
    }
    pub fn get(&self, p: [isize; 3]) -> bool {
        self.offset(p).is_some_and(|i| self.cells[i] != 0)
    }
    pub fn set(&mut self, p: [isize; 3], alive: bool) {
        if let Some(i) = self.offset(p) {
            self.cells[i] = alive as u8;
        }
    }
    pub fn step(&mut self) -> Result<StepStats> {
        self.rules.validate()?;
        ensure!(
            self.shape[0] >= (2 * self.rules.radius + 1) as usize
                && self.shape[1] >= (2 * self.rules.radius + 1) as usize
                && if self.rules.dimensions == 2 {
                    self.shape[2] == 1
                } else {
                    self.shape[2] >= 3
                },
            "invalid automaton shape"
        );
        ensure!(
            self.shape.iter().try_fold(1usize, |a, &b| a.checked_mul(b)) == Some(self.cells.len())
                && self.cells.iter().all(|&x| x <= 1),
            "invalid grid state"
        );
        let old: &Grid = self;
        let radius = old.rules.radius as isize;
        let zrange = if old.rules.dimensions == 3 { radius } else { 0 };
        let mut next = vec![0; old.cells.len()];
        next.par_iter_mut().enumerate().for_each(|(i, out)| {
            let x = (i % old.shape[0]) as isize;
            let y = (i / old.shape[0] % old.shape[1]) as isize;
            let z = (i / (old.shape[0] * old.shape[1])) as isize;
            let mut count = 0u32;
            for dz in -zrange..=zrange {
                for dy in -radius..=radius {
                    for dx in -radius..=radius {
                        if dx != 0 || dy != 0 || dz != 0 {
                            count += old.get([x + dx, y + dy, z + dz]) as u32;
                        }
                    }
                }
            }
            let mask = if old.cells[i] == 0 {
                old.rules.birth
            } else {
                old.rules.survival
            };
            *out = ((mask >> count) & 1) as u8;
        });
        let stats = StepStats {
            population: next.iter().map(|&x| x as u64).sum(),
            changed: next.iter().zip(&self.cells).filter(|(a, b)| a != b).count() as u64,
        };
        self.cells = next;
        self.tick += 1;
        Ok(stats)
    }
    pub fn population(&self) -> u64 {
        self.cells.iter().map(|&x| x as u64).sum()
    }
    pub fn brush(&mut self, center: [isize; 3], radius: usize, alive: bool) -> Result<()> {
        ensure!(
            radius <= 64 && center.iter().all(|x| x.unsigned_abs() <= 1_000_000),
            "brush radius/position budget exceeded"
        );
        let r = radius as isize;
        for z in -r..=r {
            if self.rules.dimensions == 2 && z != 0 {
                continue;
            }
            for y in -r..=r {
                for x in -r..=r {
                    if x * x + y * y + z * z <= r * r {
                        self.set([center[0] + x, center[1] + y, center[2] + z], alive);
                    }
                }
            }
        }
        Ok(())
    }
    pub fn line(&mut self, a: [isize; 2], b: [isize; 2], alive: bool) -> Result<()> {
        ensure!(
            a.iter().chain(&b).all(|x| x.unsigned_abs() <= 1_000_000),
            "line extent exceeded"
        );
        ensure!(self.rules.dimensions == 2, "line drawing is 2D");
        let (mut x, mut y) = (a[0], a[1]);
        let dx = (b[0] - x).abs();
        let dy = -(b[1] - y).abs();
        let sx = if x < b[0] { 1 } else { -1 };
        let sy = if y < b[1] { 1 } else { -1 };
        let mut error = dx + dy;
        loop {
            self.set([x, y, 0], alive);
            if x == b[0] && y == b[1] {
                break;
            }
            let e = 2 * error;
            if e >= dy {
                error += dy;
                x += sx;
            }
            if e <= dx {
                error += dx;
                y += sy;
            }
        }
        Ok(())
    }
    pub fn pattern(&mut self, name: &str) -> Result<()> {
        ensure!(self.rules.dimensions == 2, "pattern library is 2D");
        use patterns::Pattern;
        let pattern = match name {
            "glider" => Pattern::glider(),
            "blinker" => Pattern::blinker(),
            "beacon" => Pattern::beacon(),
            "toad" => Pattern::toad(),
            "lwss" => Pattern::lightweight_spaceship(),
            "pulsar" => Pattern::pulsar(),
            "gosper" => Pattern::gospel_glider_gun(),
            "r-pentomino" => Pattern {
                cells: vec![(1, 0), (2, 0), (0, 1), (1, 1), (1, 2)],
                name: "R-pentomino",
            },
            "acorn" => Pattern {
                cells: vec![(1, 0), (3, 1), (0, 2), (1, 2), (4, 2), (5, 2), (6, 2)],
                name: "Acorn",
            },
            _ => anyhow::bail!("unknown pattern"),
        };
        let cx = self.shape[0] as isize / 2;
        let cy = self.shape[1] as isize / 2;
        for (x, y) in pattern.cells {
            self.set([cx + x as isize, cy + y as isize, 0], true);
        }
        Ok(())
    }
    /// Native binary state: <=4096-byte JSON header, newline, exact u8 cell payload.
    pub fn save(&self, path: impl AsRef<Path>) -> Result<()> {
        self.validate()?;
        use sha2::{Digest, Sha256};
        let header = serde_json::json!({"schema":"NOVA-CA-v1","shape":self.shape,"rules":self.rules,"boundary":self.boundary,"tick":self.tick,"sha256":format!("{:x}",Sha256::digest(&self.cells))});
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)?;
        writeln!(file, "{header}")?;
        file.write_all(&self.cells)?;
        Ok(())
    }
    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        use sha2::{Digest, Sha256};
        let mut file = std::io::BufReader::new(std::fs::File::open(path)?);
        let mut header = Vec::new();
        loop {
            ensure!(header.len() < 4096, "CA header too large");
            let mut byte = [0];
            file.read_exact(&mut byte)?;
            if byte[0] == b'\n' {
                break;
            }
            header.push(byte[0]);
        }
        let h: serde_json::Value = serde_json::from_slice(&header)?;
        ensure!(h["schema"] == "NOVA-CA-v1", "unknown state format");
        let shape = serde_json::from_value(h["shape"].clone())?;
        let rules = serde_json::from_value(h["rules"].clone())?;
        let boundary = serde_json::from_value(h["boundary"].clone())?;
        let mut grid = Self::new(shape, rules, boundary)?;
        file.read_exact(&mut grid.cells)?;
        let mut tail = [0];
        ensure!(
            file.read(&mut tail)? == 0,
            "unexpected bytes after CA state"
        );
        ensure!(
            h["sha256"] == format!("{:x}", Sha256::digest(&grid.cells)),
            "state checksum mismatch"
        );
        grid.tick = h["tick"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("invalid tick"))?;
        grid.validate()?;
        Ok(grid)
    }
}
#[derive(Clone, Copy, Debug, Serialize)]
pub struct StepStats {
    pub population: u64,
    pub changed: u64,
}
