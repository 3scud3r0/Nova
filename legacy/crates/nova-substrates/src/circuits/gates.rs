//! Truth-table targets for circuit search, not a claim that a drawn wire is a gate.
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Serialize, Deserialize)]
pub enum Gate {
    And,
    Or,
    Not,
    Xor,
}
impl Gate {
    pub fn expected(self, a: bool, b: bool) -> bool {
        match self {
            Self::And => a && b,
            Self::Or => a || b,
            Self::Not => !a,
            Self::Xor => a ^ b,
        }
    }
}
