// SPDX-License-Identifier: AGPL-3.0-or-later
// Adapted from paulrobello/par-particle-life @ 6f495dae5b2bbb65fdafd2b7b6dab59142dfdf02.
// Copyright Paul Robello. Original and license retained in third_party/upstream.
// User-defined custom rule generators loaded from JSON files.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use super::colors::safe_palette_file_stem;
use super::expression::{EvalContext, Expr, ExprError};
use crate::par::simulation::InteractionMatrix;

/// A user-defined custom rule generator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomGenerator {
    /// Display name shown in the Rules dropdown.
    pub name: String,
    /// Tooltip description.
    #[serde(default)]
    pub description: String,
    /// DSL expression evaluated per cell (i, j, n available).
    pub expression: String,
    /// Fixed type count, or None for any count.
    #[serde(default)]
    pub num_types: Option<usize>,
    /// Parsed AST, cached after first use.
    #[serde(skip)]
    pub compiled: Option<Expr>,
}

impl CustomGenerator {
    /// Get the custom generators directory path.
    pub fn custom_dir() -> anyhow::Result<PathBuf> {
        let data_dir = dirs::data_dir().ok_or_else(|| {
            anyhow::anyhow!(
                "Could not determine user data directory for custom generators \
                 (dirs::data_dir() returned None)"
            )
        })?;
        Ok(data_dir
            .join("nova")
            .join("fusion")
            .join("custom-generators"))
    }

    /// Ensure the custom generators directory exists.
    pub fn ensure_dir() -> anyhow::Result<PathBuf> {
        let dir = Self::custom_dir()?;
        if !dir.exists() {
            std::fs::create_dir_all(&dir)?;
        }
        Ok(dir)
    }

    /// List all custom generators from the directory.
    pub fn list() -> anyhow::Result<Vec<CustomGenerator>> {
        let dir = Self::custom_dir()?;
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut generators = Vec::new();
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                let content = std::fs::read_to_string(&path)?;
                match serde_json::from_str::<CustomGenerator>(&content) {
                    Ok(generator) => generators.push(generator),
                    Err(e) => {
                        log::warn!("Failed to parse custom generator {}: {e}", path.display());
                    }
                }
            }
        }

        generators.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(generators)
    }

    /// Save this generator to a JSON file in the custom generators directory.
    pub fn save_to_file(&self) -> anyhow::Result<()> {
        let dir = Self::ensure_dir()?;
        // Reuse the palette sanitizer's alphanumeric allowlist so hostile names
        // (e.g. "..", "\\server\share", absolute paths) cannot escape the data dir
        // or collide with sibling files (SEC-006 / ARC-020).
        let filename = safe_palette_file_stem(&self.name);
        let path = dir.join(format!("{filename}.json"));
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, json)?;
        Ok(())
    }

    /// Generate an interaction matrix using this custom generator's expression.
    pub fn generate(&mut self, num_types: usize) -> Result<InteractionMatrix, ExprError> {
        if let Some(required) = self.num_types
            && num_types != required
        {
            return Err(ExprError::Eval(format!(
                "'{}' requires exactly {} types, got {}",
                self.name, required, num_types
            )));
        }

        if self.compiled.is_none() {
            let expr = Expr::parse(&self.expression)?;
            self.compiled = Some(expr);
        }

        let expr = self.compiled.as_ref().unwrap();
        let mut matrix = InteractionMatrix::new(num_types);

        // Use a seeded RNG so the same custom-generator expression reproduces
        // the same matrix across runs (ARC-019). The DSL `random()` builtin
        // draws from this RNG; deterministic generators that don't call
        // `random()` are unaffected.
        let mut rng = super::seeded_rng();

        for i in 0..num_types {
            for j in 0..num_types {
                let ctx = EvalContext {
                    i: i as f32,
                    j: j as f32,
                    n: num_types as f32,
                };
                let val = expr.eval(&ctx, &mut rng)?;
                matrix.set(i, j, val);
            }
        }

        for val in &mut matrix.data {
            *val = (*val * 100.0).round() / 100.0;
        }

        // ARC-006: a NaN/Inf in any cell poisons the GPU compute shader with no
        // diagnostic. matrix.validate() catches NaN/Inf and out-of-range values;
        // surface the offending (i, j) so the user can fix the expression.
        if let Err(msg) = matrix.validate() {
            for i in 0..num_types {
                for j in 0..num_types {
                    let val = matrix.get(i, j);
                    if val.is_nan() || val.is_infinite() {
                        return Err(ExprError::Eval(format!(
                            "expression produced {val} at ({i}, {j}) \
                             for '{name}' — likely pow() of negative base or overflow ({msg})",
                            name = self.name
                        )));
                    }
                }
            }
            return Err(ExprError::Eval(format!(
                "expression for '{}' produced an out-of-range value: {msg}",
                self.name
            )));
        }

        Ok(matrix)
    }
}
