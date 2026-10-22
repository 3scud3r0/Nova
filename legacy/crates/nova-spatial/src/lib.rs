//! Exact neighbor candidate queries in signed 21-bit cells. No wrapped keys.
use anyhow::{ensure, Result};
use nova_core::Particles;
use std::collections::HashMap;
use std::ops::Range;
const BIAS: i32 = 1 << 20;
fn spread(v: u32) -> u64 {
    let mut x = (v & 0x1fffff) as u64;
    x = (x | (x << 32)) & 0x1f00000000ffff;
    x = (x | (x << 16)) & 0x1f0000ff0000ff;
    x = (x | (x << 8)) & 0x100f00f00f00f00f;
    x = (x | (x << 4)) & 0x10c30c30c30c30c3;
    (x | (x << 2)) & 0x1249249249249249
}
pub fn morton(cell: [i32; 3]) -> Option<u64> {
    if cell.iter().any(|&x| !(-BIAS..BIAS).contains(&x)) {
        return None;
    }
    Some(
        spread((cell[0] + BIAS) as u32)
            | (spread((cell[1] + BIAS) as u32) << 1)
            | (spread((cell[2] + BIAS) as u32) << 2),
    )
}
pub struct CellList {
    width: f32,
    ranges: HashMap<u64, Range<usize>>,
}
impl CellList {
    pub fn rebuild(p: &mut Particles, width: f32) -> Result<Self> {
        ensure!(
            width.is_finite() && width > 0.,
            "positive finite cell width required"
        );
        p.validate()?;
        let mut indexed = Vec::with_capacity(p.len());
        for (i, pos) in p.positions.iter().enumerate() {
            let cell = Self::coordinate(pos.0, width)?;
            indexed.push((morton(cell).unwrap(), p.ids[i], i));
        }
        indexed.sort_unstable();
        p.reorder(&indexed.iter().map(|x| x.2).collect::<Vec<_>>());
        let mut ranges = HashMap::new();
        for (i, (key, _, _)) in indexed.iter().enumerate() {
            ranges
                .entry(*key)
                .and_modify(|r: &mut Range<usize>| r.end = i + 1)
                .or_insert(i..i + 1);
        }
        Ok(Self { width, ranges })
    }
    fn coordinate(p: [f32; 4], width: f32) -> Result<[i32; 3]> {
        let q = [
            (p[0] / width).floor(),
            (p[1] / width).floor(),
            (p[2] / width).floor(),
        ];
        ensure!(
            q.iter()
                .all(|x| x.is_finite() && *x >= -(BIAS as f32) && *x < (BIAS as f32)),
            "position exceeds signed 21-bit spatial domain"
        );
        Ok(q.map(|x| x as i32))
    }
    /// Call with a query radius no greater than the cell width.
    pub fn candidates(&self, p: [f32; 4]) -> impl Iterator<Item = usize> + '_ {
        let c = Self::coordinate(p, self.width).expect("validated particle position");
        (-1..=1)
            .flat_map(move |x| {
                (-1..=1).flat_map(move |y| (-1..=1).map(move |z| [c[0] + x, c[1] + y, c[2] + z]))
            })
            .filter_map(|c| morton(c).and_then(|k| self.ranges.get(&k)))
            .flat_map(|r| r.clone())
    }
}

pub mod bvh;

pub mod octree;
