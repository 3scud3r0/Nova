//! Finite overlap compatibility for declared sections; not a global sheaf theorem.
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Section {
    pub context_sha256: String,
    pub units: BTreeMap<String, String>,
    pub values: BTreeMap<String, f64>,
}
impl Section {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.context_sha256.len() == 64
                && self.context_sha256.bytes().all(|x| x.is_ascii_hexdigit())
                && self.values.len() <= 256
                && self.values.len() == self.units.len(),
            "invalid section context"
        );
        for (label, value) in &self.values {
            ensure!(
                !label.is_empty()
                    && label.len() <= 128
                    && value.is_finite()
                    && self.units.get(label).is_some_and(|u| u.len() <= 64),
                "invalid section value/unit"
            )
        }
        Ok(())
    }
}
#[derive(Serialize)]
pub struct Conflict {
    pub label: String,
    pub previous: f64,
    pub incoming: f64,
    pub reason: String,
}
#[derive(Default)]
pub struct CoherenceGraph {
    sections: BTreeMap<String, Section>,
}
impl CoherenceGraph {
    /// Same context must encode the same model, seed, tick and measurement convention.
    /// Restrict sections to shared labels before comparing values and units.
    pub fn merge(&mut self, section: Section, tolerance: f64) -> Result<Vec<Conflict>> {
        section.validate()?;
        ensure!(
            tolerance.is_finite() && tolerance >= 0.,
            "invalid tolerance"
        );
        let mut conflicts = vec![];
        if let Some(previous) = self.sections.get_mut(&section.context_sha256) {
            let union: std::collections::BTreeSet<_> = previous
                .values
                .keys()
                .chain(section.values.keys())
                .collect();
            ensure!(union.len() <= 256, "section union capacity exceeded");
            for (label, &incoming) in &section.values {
                if let Some(&old) = previous.values.get(label) {
                    let unit_equal = previous.units.get(label) == section.units.get(label);
                    if !unit_equal
                        || (old - incoming).abs() > tolerance * (1. + old.abs().max(incoming.abs()))
                    {
                        conflicts.push(Conflict {
                            label: label.clone(),
                            previous: old,
                            incoming,
                            reason: if unit_equal {
                                "overlap-value"
                            } else {
                                "unit-mismatch"
                            }
                            .into(),
                        });
                    }
                }
            }
            if conflicts.is_empty() {
                previous.values.extend(section.values);
                previous.units.extend(section.units);
            }
        } else {
            ensure!(self.sections.len() < 4096, "context capacity");
            self.sections
                .insert(section.context_sha256.clone(), section);
        }
        Ok(conflicts)
    }
}
