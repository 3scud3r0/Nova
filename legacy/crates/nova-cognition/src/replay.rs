use nova_core::SplitMix64;
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct Transition {
    pub x: [f32; 16],
    pub y: [f32; 16],
    pub action: [f32; 4],
    pub priority: f32,
}
pub struct Replay {
    entries: Vec<Transition>,
    capacity: usize,
    seen: u64,
}
impl Replay {
    pub fn new(capacity: usize) -> Self {
        Self {
            entries: vec![],
            capacity,
            seen: 0,
        }
    }
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
    pub fn insert(&mut self, t: Transition, rng: &mut SplitMix64) {
        self.seen = self.seen.saturating_add(1);
        if self.entries.len() < self.capacity {
            self.entries.push(t)
        } else {
            let j = (rng.next_u64() % self.seen) as usize;
            if j < self.capacity {
                self.entries[j] = t
            }
        }
    }
    pub fn sample(&self, rng: &mut SplitMix64) -> Option<Transition> {
        if self.entries.is_empty() {
            return None;
        }
        let total = self.entries.iter().map(|t| t.priority as f64).sum::<f64>();
        let mut q = rng.unit() as f64 * total;
        for t in &self.entries {
            q -= t.priority as f64;
            if q <= 0. {
                return Some(*t);
            }
        }
        self.entries.last().copied()
    }
}
