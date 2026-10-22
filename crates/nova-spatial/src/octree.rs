//! Sparse octree over a finite bounding cube, rebuilt when the open cloud expands.
use anyhow::{ensure, Result};
struct Node {
    center: [f32; 3],
    half: f32,
    ids: Vec<usize>,
    children: Vec<Node>,
}
pub struct Octree {
    points: Vec<[f32; 3]>,
    root: Node,
}
impl Octree {
    pub fn build(points: &[[f32; 3]]) -> Result<Self> {
        ensure!(
            points.len() <= 10_000_000
                && points
                    .iter()
                    .flatten()
                    .all(|x| x.is_finite() && x.abs() < 1e15),
            "invalid octree point cloud"
        );
        let mut lo = [f32::INFINITY; 3];
        let mut hi = [f32::NEG_INFINITY; 3];
        for p in points {
            for k in 0..3 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
        let center = if points.is_empty() {
            [0.; 3]
        } else {
            std::array::from_fn(|k| (lo[k] + hi[k]) * 0.5)
        };
        let half = if points.is_empty() {
            1.
        } else {
            (0..3)
                .map(|k| (hi[k] - lo[k]) * 0.50001)
                .fold(1e-5, f32::max)
        };
        fn build_node(
            points: &[[f32; 3]],
            ids: Vec<usize>,
            center: [f32; 3],
            half: f32,
            depth: u32,
        ) -> Node {
            if ids.len() <= 16 || depth == 20 {
                return Node {
                    center,
                    half,
                    ids,
                    children: vec![],
                };
            }
            let mut buckets: [Vec<usize>; 8] = std::array::from_fn(|_| vec![]);
            for id in ids {
                let p = points[id];
                let key = (p[0] >= center[0]) as usize
                    | ((p[1] >= center[1]) as usize) << 1
                    | ((p[2] >= center[2]) as usize) << 2;
                buckets[key].push(id);
            }
            let mut children = vec![];
            for (key, ids) in buckets.into_iter().enumerate() {
                if !ids.is_empty() {
                    let c = std::array::from_fn(|k| {
                        center[k]
                            + if key & (1 << k) == 0 {
                                -half * 0.5
                            } else {
                                half * 0.5
                            }
                    });
                    children.push(build_node(points, ids, c, half * 0.5, depth + 1));
                }
            }
            Node {
                center,
                half,
                ids: vec![],
                children,
            }
        }
        Ok(Self {
            points: points.to_vec(),
            root: build_node(points, (0..points.len()).collect(), center, half, 0),
        })
    }
    pub fn within(&self, center: [f32; 3], radius: f32) -> Result<Vec<usize>> {
        ensure!(
            center.iter().all(|x| x.is_finite()) && radius.is_finite() && radius >= 0.,
            "invalid sphere"
        );
        fn visit(
            node: &Node,
            points: &[[f32; 3]],
            center: [f32; 3],
            r2: f32,
            out: &mut Vec<usize>,
        ) {
            let distance: f32 = (0..3)
                .map(|k| {
                    ((center[k] - node.center[k]).abs() - node.half)
                        .max(0.)
                        .powi(2)
                })
                .sum();
            if distance > r2 {
                return;
            }
            for &id in &node.ids {
                if (0..3)
                    .map(|k| (points[id][k] - center[k]).powi(2))
                    .sum::<f32>()
                    <= r2
                {
                    out.push(id);
                }
            }
            for child in &node.children {
                visit(child, points, center, r2, out);
            }
        }
        let mut out = vec![];
        visit(&self.root, &self.points, center, radius * radius, &mut out);
        Ok(out)
    }
}
