//! Median-split bounding-volume hierarchy for nonuniform broad-phase queries.
use anyhow::{ensure, Result};
#[derive(Clone, Copy, Debug)]
pub struct Bounds {
    pub min: [f32; 3],
    pub max: [f32; 3],
}
impl Bounds {
    fn intersects(&self, other: &Self) -> bool {
        (0..3).all(|k| self.min[k] <= other.max[k] && other.min[k] <= self.max[k])
    }
    fn union(&self, other: &Self) -> Self {
        Self {
            min: std::array::from_fn(|k| self.min[k].min(other.min[k])),
            max: std::array::from_fn(|k| self.max[k].max(other.max[k])),
        }
    }
}
enum Node {
    Leaf(Bounds, Vec<usize>),
    Branch(Bounds, Box<Node>, Box<Node>),
}
pub struct Bvh {
    root: Option<Node>,
}
impl Bvh {
    pub fn build(boxes: &[Bounds]) -> Result<Self> {
        ensure!(
            boxes.iter().all(|b| (0..3)
                .all(|k| b.min[k].is_finite() && b.max[k].is_finite() && b.min[k] <= b.max[k])),
            "invalid AABB"
        );
        fn node(boxes: &[Bounds], mut ids: Vec<usize>) -> Node {
            let bounds = ids
                .iter()
                .skip(1)
                .fold(boxes[ids[0]], |b, &i| b.union(&boxes[i]));
            if ids.len() <= 8 {
                return Node::Leaf(bounds, ids);
            }
            let axis = (0..3)
                .max_by(|&a, &b| {
                    (bounds.max[a] - bounds.min[a]).total_cmp(&(bounds.max[b] - bounds.min[b]))
                })
                .unwrap();
            ids.sort_unstable_by(|&a, &b| {
                (boxes[a].min[axis] + boxes[a].max[axis])
                    .total_cmp(&(boxes[b].min[axis] + boxes[b].max[axis]))
            });
            let right = ids.split_off(ids.len() / 2);
            Node::Branch(
                bounds,
                Box::new(node(boxes, ids)),
                Box::new(node(boxes, right)),
            )
        }
        Ok(Self {
            root: (!boxes.is_empty()).then(|| node(boxes, (0..boxes.len()).collect())),
        })
    }
    /// Broad-phase candidates; caller applies exact geometry intersection.
    pub fn query(&self, bounds: Bounds) -> Vec<usize> {
        fn visit(n: &Node, b: &Bounds, out: &mut Vec<usize>) {
            match n {
                Node::Leaf(a, ids) => {
                    if a.intersects(b) {
                        out.extend(ids);
                    }
                }
                Node::Branch(a, l, r) => {
                    if a.intersects(b) {
                        visit(l, b, out);
                        visit(r, b, out);
                    }
                }
            }
        }
        let mut out = Vec::new();
        if let Some(root) = &self.root {
            visit(root, &bounds, &mut out);
        }
        out
    }
}
