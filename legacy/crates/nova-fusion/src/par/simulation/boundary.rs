// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from paulrobello/par-particle-life @ 6f495dae5b2bbb65fdafd2b7b6dab59142dfdf02.
// Copyright Paul Robello. Original and license retained in third_party/upstream.
// Boundary condition handling for the simulation.

use serde::{Deserialize, Serialize};

/// Defines how particles interact with world boundaries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum BoundaryMode {
    /// Particles are repelled from walls, bouncing back.
    #[default]
    Repel,

    /// Particles wrap around to the opposite side.
    Wrap,

    /// Particles wrap with mirrored rendering effect.
    MirrorWrap,

    /// Infinite tiling - particles rendered multiple times.
    InfiniteWrap,
}

impl BoundaryMode {
    /// Get all available boundary modes.
    pub fn all() -> &'static [BoundaryMode] {
        &[
            BoundaryMode::Repel,
            BoundaryMode::Wrap,
            BoundaryMode::MirrorWrap,
            BoundaryMode::InfiniteWrap,
        ]
    }

    /// Get the display name for this mode.
    pub fn display_name(&self) -> &'static str {
        match self {
            BoundaryMode::Repel => "Repel (Bounce)",
            BoundaryMode::Wrap => "Wrap Around",
            BoundaryMode::MirrorWrap => "Mirror Wrap",
            BoundaryMode::InfiniteWrap => "Infinite Tiling",
        }
    }
}
