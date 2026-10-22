//! Native fusion of pinned, attributed upstream particle engines.
//! SPDX-License-Identifier: AGPL-3.0-or-later
pub mod attractors;
pub mod breeding;
pub mod grid;
pub mod par;
use anyhow::{Result, ensure};
use nova_core::{Float4, Particles, SplitMix64};
use par::generators::{
    colors::{PaletteType, generate_colors},
    positions::{PositionPattern, SpawnConfig, generate_positions},
    rules::{RuleType, generate_rules},
};
use par::simulation::matrix_variation::MatrixVariationConfig;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
pub type Matrix = [[f32; 8]; 8];
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Family {
    Hunar,
    Realethersim,
    PrimordialDish,
    ParParticleLife,
    Fusion,
    #[serde(rename = "cellflow")]
    CellFlow,
}
impl Family {
    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "hunar" => Ok(Self::Hunar),
            "realethersim" => Ok(Self::Realethersim),
            "primordial-dish" => Ok(Self::PrimordialDish),
            "par-particle-life" => Ok(Self::ParParticleLife),
            "fusion" => Ok(Self::Fusion),
            "cellflow" => Ok(Self::CellFlow),
            _ => anyhow::bail!("unknown fusion family: {s}"),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Boundary {
    Open,
    Wrap,
    Bounce,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CellParameters {
    pub repulsion: f32,
    pub attraction: f32,
    pub falloff: f32,
    pub balance: f32,
    pub expected_neighbors: f32,
}
impl Default for CellParameters {
    fn default() -> Self {
        Self {
            repulsion: 50.,
            attraction: 0.62,
            falloff: 16.57,
            balance: 0.79,
            expected_neighbors: 32.,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub family: Family,
    pub dimensions: usize,
    pub species: usize,
    pub half_extent: [f32; 3],
    pub boundary: Boundary,
    pub dt: f32,
    pub beta: f32,
    pub retention: f32,
    pub force: f32,
    pub min_radius: Matrix,
    pub max_radius: Matrix,
    pub masses: [f32; 8],
    pub repel_strength: f32,
    pub velocity_coupling: f32,
    pub temperature: f32,
    pub max_speed: f32,
    pub density_limit: f32,
    pub variation: MatrixVariationConfig,
    #[serde(default)]
    pub cell: CellParameters,
}
impl Settings {
    pub fn for_family(family: Family) -> Self {
        let mut s = Self {
            family,
            dimensions: 2,
            species: 5,
            half_extent: [640., 360., 1.],
            boundary: Boundary::Wrap,
            dt: 1. / 60.,
            beta: 0.3,
            retention: 0.85,
            force: 900.,
            min_radius: [[15.; 8]; 8],
            max_radius: [[50.; 8]; 8],
            masses: [1.; 8],
            repel_strength: 1.,
            velocity_coupling: 0.,
            temperature: 0.,
            max_speed: 0.,
            density_limit: 0.,
            variation: Default::default(),
            cell: Default::default(),
        };
        match family {
            Family::Hunar => {
                s.species = 2;
                s.half_extent = [150., 150., 1.];
                s.boundary = Boundary::Bounce;
                s.dt = 1.;
                s.retention = 0.5;
                s.force = 1.;
                s.max_radius = [[80.; 8]; 8];
                s.min_radius = [[20.; 8]; 8];
            }
            Family::Realethersim => {
                s.dimensions = 3;
                s.half_extent = [1.5; 3];
                s.dt = 0.015;
                s.force = 4.;
                s.retention = 0.86;
                s.max_radius = [[0.55; 8]; 8];
                s.min_radius = [[0.165; 8]; 8];
            }
            Family::ParParticleLife => {
                s.half_extent = [960., 540., 1.];
                s.species = 6;
                s.dt = 1.;
                s.force = 1.;
                s.retention = 0.95;
                s.max_radius = [[80.; 8]; 8];
                s.min_radius = [[30.; 8]; 8];
                s.max_speed = 20.;
                s.velocity_coupling = 0.1;
            }
            Family::Fusion => {
                s.dimensions = 3;
                s.half_extent = [16., 9., 9.];
                s.species = 5;
                s.dt = 1. / 60.;
                s.force = 24.;
                s.retention = 0.92;
                s.max_radius = [[0.8; 8]; 8];
                s.min_radius = [[0.24; 8]; 8];
                s.velocity_coupling = 0.15;
            }
            Family::CellFlow => {
                s.species = 6;
                s.dt = 0.22;
                s.retention = 0.71;
                s.force = 2.33;
            }
            Family::PrimordialDish => (),
        }
        s
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(
            (2..=3).contains(&self.dimensions) && (1..=8).contains(&self.species),
            "2D/3D and 1..8 species required"
        );
        ensure!(
            self.half_extent
                .iter()
                .all(|x| x.is_finite() && *x > 0. && *x <= 1e6),
            "invalid world extent"
        );
        ensure!(
            [
                self.dt,
                self.beta,
                self.retention,
                self.force,
                self.repel_strength,
                self.velocity_coupling,
                self.temperature,
                self.max_speed,
                self.density_limit,
                self.variation.amplitude,
                self.variation.speed
            ]
            .iter()
            .all(|x| x.is_finite()),
            "nonfinite fusion setting"
        );
        ensure!(
            self.dt > 0.
                && self.dt <= 1.
                && self.beta > 0.
                && self.beta < 1.
                && (0.0..=1.).contains(&self.retention)
                && self.force >= 0.
                && self.repel_strength >= 0.
                && self.velocity_coupling >= 0.
                && self.temperature >= 0.
                && self.max_speed >= 0.
                && self.density_limit >= 0.,
            "invalid fusion dynamics"
        );
        ensure!(
            (0.0..=1.).contains(&self.variation.amplitude) && self.variation.speed >= 0.,
            "invalid matrix variation"
        );
        ensure!(
            self.masses.iter().all(|m| m.is_finite() && *m > 1e-6),
            "positive finite type masses required"
        );
        for i in 0..8 {
            for j in 0..8 {
                let a = self.min_radius[i][j];
                let b = self.max_radius[i][j];
                ensure!(
                    a.is_finite() && b.is_finite() && a > 0. && b > a && b <= 1e6,
                    "invalid pair radii"
                );
            }
        }
        ensure!(
            [
                self.cell.repulsion,
                self.cell.attraction,
                self.cell.falloff,
                self.cell.balance,
                self.cell.expected_neighbors
            ]
            .iter()
            .all(|x| x.is_finite())
                && self.cell.repulsion >= 0.
                && self.cell.attraction >= 0.
                && self.cell.falloff >= 0.
                && (0.0..=1.).contains(&self.cell.balance)
                && self.cell.expected_neighbors > 0.,
            "invalid CellFlow parameters"
        );
        Ok(())
    }
    pub fn cutoff(&self) -> f32 {
        self.max_radius.iter().flatten().copied().fold(0., f32::max)
    }
    pub fn displacement(&self, a: [f32; 4], b: [f32; 4]) -> [f32; 3] {
        let mut d = [0.; 3];
        for k in 0..self.dimensions {
            d[k] = b[k] - a[k];
            if self.boundary == Boundary::Wrap {
                let l = 2. * self.half_extent[k];
                d[k] -= l * (d[k] / l).round();
            }
        }
        d
    }
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
pub struct Statistics {
    pub candidates: u64,
    pub interacting_pairs: u64,
    pub speed_clamps: u64,
    pub density_scaled: u64,
}
pub struct Model {
    pub settings: Settings,
    pub preserve_masses: bool,
    pub palette: Vec<[f32; 4]>,
    pub stats: Statistics,
    pub rule_history: Vec<breeding::RuleLineage>,
    pub previous_neighbors: Vec<u32>,
    brush: Option<([f32; 3], f32, f32)>,
}
impl Model {
    pub fn new(family: Family) -> Self {
        let settings = Settings::for_family(family);
        Self {
            settings,
            preserve_masses: false,
            palette: generate_colors(PaletteType::default(), 8),
            stats: Default::default(),
            rule_history: vec![],
            previous_neighbors: vec![],
            brush: None,
        }
    }
    pub fn initialize(&mut self, p: &mut Particles, matrix: &mut Matrix, seed: u64) -> Result<()> {
        self.settings.validate()?;
        let s = &self.settings;
        let mut rng = SplitMix64(seed);
        let generated =
            par::generators::with_seed(seed, || generate_rules(RuleType::Random, s.species));
        *matrix = [[0.; 8]; 8];
        for (i, row) in matrix.iter_mut().enumerate().take(s.species) {
            for (j, x) in row.iter_mut().enumerate().take(s.species) {
                *x = generated.get(i, j);
            }
        }
        if matches!(s.family, Family::PrimordialDish | Family::Fusion) {
            *matrix = breeding::preset("genesis")?.matrix8()?;
        }
        if s.family == Family::Hunar {
            *matrix = [[0.; 8]; 8];
            matrix[0][0] = 0.1;
            matrix[0][1] = -0.15;
            matrix[1][1] = -0.1;
        }
        if s.family == Family::CellFlow {
            for row in matrix.iter_mut().take(s.species) {
                for x in row.iter_mut().take(s.species) {
                    *x = (rng.signed().tanh() * 0.28 - 0.20).clamp(-1., 1.);
                }
            }
        }
        self.previous_neighbors = vec![0; p.len()];
        let n = p.len();
        for i in 0..n {
            p.phenotypes[i][0] = if s.family == Family::Realethersim {
                (i * s.species / n) as u32
            } else {
                (i % s.species) as u32
            };
            for k in 0..3 {
                p.positions[i].0[k] = if k < s.dimensions {
                    rng.signed() * s.half_extent[k]
                } else {
                    0.
                };
                p.velocities[i].0[k] = 0.;
            }
            p.positions[i].0[3] = if s.family == Family::Realethersim {
                0.015
            } else if s.family == Family::Fusion {
                0.06
            } else {
                3.
            };
            if s.family == Family::PrimordialDish {
                let angle = rng.unit() * std::f32::consts::TAU;
                let speed = 30. + 60. * rng.unit();
                p.velocities[i].0[0] = angle.cos() * speed;
                p.velocities[i].0[1] = angle.sin() * speed;
            }
            p.velocities[i].0[3] = s.masses[p.phenotypes[i][0] as usize];
        }
        self.rule_history
            .push(breeding::RuleLineage::new(matrix, vec![], 0, "initialize"));
        p.validate()
    }
    pub fn apply_preset(
        &mut self,
        p: &mut Particles,
        matrix: &mut Matrix,
        name: &str,
    ) -> Result<()> {
        let preset = breeding::preset(name)?;
        let old = self.settings.clone();
        self.settings.species = preset.num_species;
        self.settings.beta = preset.beta;
        self.settings.retention = preset.damping;
        self.settings.force = preset.force_factor;
        self.settings.max_radius = [[preset.rmax; 8]; 8];
        self.settings.min_radius = [[preset.rmax * preset.beta; 8]; 8];
        if let Err(e) = self.settings.validate() {
            self.settings = old;
            return Err(e);
        }
        *matrix = preset.matrix8()?;
        for t in &mut p.phenotypes {
            t[0] %= preset.num_species as u32;
        }
        self.note_rule(matrix, "preset");
        Ok(())
    }
    pub fn select_generators(
        &mut self,
        p: &mut Particles,
        matrix: &mut Matrix,
        rule: usize,
        pattern: usize,
        palette: usize,
    ) -> Result<()> {
        let rules = RuleType::all();
        let patterns = PositionPattern::all();
        let colors = PaletteType::all();
        ensure!(
            rule < rules.len() && pattern < patterns.len() && palette < colors.len(),
            "generator index out of bounds"
        );
        let k = self.settings.species;
        let m = generate_rules(rules[rule], k);
        for i in 0..k {
            for j in 0..k {
                matrix[i][j] = m.get(i, j);
            }
        }
        let cfg = SpawnConfig {
            num_particles: p.len(),
            num_types: k,
            width: 2. * self.settings.half_extent[0],
            height: 2. * self.settings.half_extent[1],
        };
        let positions = generate_positions(patterns[pattern], &cfg);
        ensure!(positions.len() == p.len(), "generator returned wrong count");
        for (i, part) in positions.iter().enumerate() {
            p.positions[i].0[0] = part.x - self.settings.half_extent[0];
            p.positions[i].0[1] = part.y - self.settings.half_extent[1];
            p.phenotypes[i][0] = part.particle_type;
            p.velocities[i].0[0] = part.vx;
            p.velocities[i].0[1] = part.vy;
        }
        self.palette = generate_colors(colors[palette], 8);
        self.note_rule(matrix, "generator");
        p.validate()
    }
    pub fn note_rule(&mut self, matrix: &Matrix, operator: &str) {
        let parents = self
            .rule_history
            .last()
            .map(|p| vec![p.hash.clone()])
            .unwrap_or_default();
        let depth = self
            .rule_history
            .last()
            .map(|p| p.generation + 1)
            .unwrap_or(0);
        self.rule_history
            .push(breeding::RuleLineage::new(matrix, parents, depth, operator));
    }
    pub fn set_brush(&mut self, center: [f32; 3], radius: f32, strength: f32) -> Result<()> {
        ensure!(
            center.iter().all(|x| x.is_finite())
                && radius.is_finite()
                && radius > 0.
                && strength.is_finite(),
            "invalid radial brush"
        );
        self.brush = Some((center, radius, strength));
        Ok(())
    }
    pub fn take_brush(&mut self) -> Option<([f32; 3], f32, f32)> {
        self.brush.take()
    }
    pub fn step(&mut self, p: &mut Particles, base: &Matrix, tick: u64) -> Result<()> {
        self.settings.validate()?;
        p.validate()?;
        ensure!(
            base.iter()
                .flatten()
                .all(|x| x.is_finite() && x.abs() <= 1.),
            "affinity matrix outside [-1,1]"
        );
        ensure!(
            p.phenotypes
                .iter()
                .all(|x| (x[0] as usize) < self.settings.species),
            "particle type exceeds selected species count"
        );
        if !self.preserve_masses {
            for i in 0..p.len() {
                p.velocities[i].0[3] = self.settings.masses[p.phenotypes[i][0] as usize];
            }
        }
        let matrix = self.varied_matrix(base, tick);
        let s = &self.settings;
        let grid = grid::Grid::build(p, s)?;
        ensure!(
            self.previous_neighbors.len() == p.len(),
            "fusion membership changed; reinitialize model"
        );
        let brush = self.brush.take();
        let results: Vec<_> = (0..p.len())
            .into_par_iter()
            .map(|i| {
                let mut force = [0.; 3];
                let mut align = [0.; 3];
                let mut weight_sum = 0.;
                let xi = p.positions[i].0;
                let vi = p.velocities[i].0;
                let a = p.phenotypes[i][0] as usize;
                let mut checked = 0u64;
                let mut interacting = 0;
                for j in grid.candidates(xi) {
                    if i == j {
                        continue;
                    }
                    checked += 1;
                    let d = s.displacement(xi, p.positions[j].0);
                    let distance2 = d.iter().map(|x| x * x).sum::<f32>();
                    let b = p.phenotypes[j][0] as usize;
                    let max = s.max_radius[a][b];
                    if distance2 >= max * max
                        || distance2
                            < if s.family == Family::Realethersim {
                                1e-10
                            } else {
                                1e-4
                            }
                    {
                        continue;
                    }
                    let distance = distance2.sqrt();
                    let min = s.min_radius[a][b];
                    let f = match s.family {
                        Family::Hunar => -matrix[a][b],
                        Family::CellFlow => {
                            let q = distance / max;
                            matrix[a][b]
                                * (s.cell.repulsion / (1. + (s.cell.falloff * q).powi(2))
                                    - s.cell.attraction * q * q)
                        }
                        _ => {
                            if distance < min {
                                (distance / min - 1.) * s.repel_strength
                            } else {
                                matrix[a][b]
                                    * (1. - (2. * distance - min - max).abs() / (max - min))
                            }
                        }
                    };
                    interacting += 1;
                    for k in 0..s.dimensions {
                        force[k] += d[k] / distance * f;
                    }
                    if s.velocity_coupling > 0. && distance >= min {
                        let w = 1. - (distance - min) / (max - min);
                        weight_sum += w;
                        for k in 0..s.dimensions {
                            align[k] += (p.velocities[j].0[k] - vi[k]) * w;
                        }
                    }
                }
                if weight_sum > 0. {
                    for k in 0..s.dimensions {
                        force[k] += s.velocity_coupling * align[k] / weight_sum;
                    }
                }
                let density_scale = if s.density_limit > 0. && (checked as f32) > s.density_limit {
                    s.density_limit / checked as f32
                } else {
                    1.
                };
                let feedback = if s.family == Family::CellFlow {
                    let density = (self.previous_neighbors[i] as f32 / s.cell.expected_neighbors)
                        .clamp(0., 1.);
                    1. + 3. * s.cell.balance - 3.99 * s.cell.balance * density
                } else {
                    1.
                };
                let mut v = vi;
                let mut x = xi;
                let kick = if matches!(s.family, Family::Hunar | Family::ParParticleLife) {
                    s.force
                } else {
                    s.force * s.dt
                };
                for k in 0..s.dimensions {
                    let dv = kick * force[k] / s.masses[a] * density_scale * feedback;
                    v[k] = if matches!(s.family, Family::PrimordialDish | Family::CellFlow) {
                        vi[k] * s.retention + dv
                    } else {
                        (vi[k] + dv) * s.retention
                    };
                    if s.temperature > 0. {
                        v[k] += noise(p.ids[i], tick, k) * s.temperature;
                    }
                }
                if let Some((center, radius, strength)) = brush {
                    let target = [center[0], center[1], center[2], 0.];
                    let d = s.displacement(xi, target);
                    let distance = (d.iter().map(|v| v * v).sum::<f32>()).sqrt();
                    if distance > 1e-6 && distance < radius {
                        for k in 0..s.dimensions {
                            v[k] += d[k] / distance * strength * (1. - distance / radius) * s.dt;
                        }
                    }
                }
                let speed = (v[..s.dimensions].iter().map(|x| x * x).sum::<f32>()).sqrt();
                let clamped = s.max_speed > 0. && speed > s.max_speed;
                if clamped {
                    for value in &mut v[..s.dimensions] {
                        *value *= s.max_speed / speed;
                    }
                }
                for k in 0..s.dimensions {
                    x[k] += s.dt * v[k];
                    match s.boundary {
                        Boundary::Open => (),
                        Boundary::Wrap => {
                            x[k] = (x[k] + s.half_extent[k]).rem_euclid(2. * s.half_extent[k])
                                - s.half_extent[k]
                        }
                        Boundary::Bounce => {
                            let l = 2. * s.half_extent[k];
                            let q = (x[k] + s.half_extent[k]).rem_euclid(2. * l);
                            let reflected = q > l;
                            x[k] = if reflected {
                                2. * l - q - s.half_extent[k]
                            } else {
                                q - s.half_extent[k]
                            };
                            if reflected {
                                v[k] = -v[k];
                            }
                        }
                    }
                }
                (
                    Float4(x),
                    Float4(v),
                    checked,
                    interacting,
                    clamped,
                    density_scale < 1.,
                )
            })
            .collect();
        for (i, (x, v, checked, active, clamp, scaled)) in results.into_iter().enumerate() {
            p.positions[i] = x;
            p.velocities[i] = v;
            self.previous_neighbors[i] = active as u32;
            self.stats.candidates += checked;
            self.stats.interacting_pairs += active;
            self.stats.speed_clamps += clamp as u64;
            self.stats.density_scaled += scaled as u64;
        }
        p.validate()
    }
    pub fn varied_matrix(&self, base: &Matrix, tick: u64) -> Matrix {
        let mut flat = par::simulation::InteractionMatrix::new(8);
        for i in 0..8 {
            for j in 0..8 {
                flat.set(i, j, base[i][j]);
            }
        }
        let varied = self
            .settings
            .variation
            .apply(&flat, tick as f32 * self.settings.dt);
        std::array::from_fn(|i| std::array::from_fn(|j| varied.get(i, j)))
    }
}
fn noise(id: u64, tick: u64, axis: usize) -> f32 {
    fn pcg(input: u32) -> u32 {
        let state = input.wrapping_mul(747796405).wrapping_add(2891336453);
        let word = ((state >> ((state >> 28) + 4)) ^ state).wrapping_mul(277803737);
        (word >> 22) ^ word
    }
    pcg((id as u32)
        .wrapping_add((tick as u32).wrapping_mul(74839))
        .wrapping_add(axis as u32 * 7919)) as f32
        / u32::MAX as f32
        - 0.5
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SavedPreset {
    pub schema: String,
    pub settings: Settings,
    pub matrix: Matrix,
    pub palette: Vec<[f32; 4]>,
}
impl SavedPreset {
    pub fn capture(model: &Model, matrix: Matrix) -> Self {
        Self {
            schema: "NOVA-FUSION-PRESET-v1".into(),
            settings: model.settings.clone(),
            matrix,
            palette: model.palette.clone(),
        }
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.schema == "NOVA-FUSION-PRESET-v1",
            "unknown preset schema"
        );
        self.settings.validate()?;
        ensure!(
            self.matrix
                .iter()
                .flatten()
                .all(|x| x.is_finite() && x.abs() <= 1.)
                && self.palette.len() == 8
                && self
                    .palette
                    .iter()
                    .flatten()
                    .all(|x| x.is_finite() && (0.0..=1.).contains(x)),
            "invalid palette/matrix"
        );
        Ok(())
    }
}
pub fn catalog() -> serde_json::Value {
    serde_json::json!({
        "sources":["hunar","realethersim","primordial-dish","par-particle-life","fusion","cellflow"],
        "rules":RuleType::all().iter().enumerate().map(|(i,x)|serde_json::json!({"id":i,"name":x.display_name()})).collect::<Vec<_>>(),
        "positions":PositionPattern::all().iter().enumerate().map(|(i,x)|serde_json::json!({"id":i,"name":x.display_name()})).collect::<Vec<_>>(),
        "palettes":PaletteType::all().iter().enumerate().map(|(i,x)|serde_json::json!({"id":i,"name":x.display_name()})).collect::<Vec<_>>(),
        "dish_presets":["genesis","orbs","garden","symbiotes","polymers"],
        "attractors":["lorenz","rossler","aizawa","thomas"],
        "license":"AGPL-3.0-or-later; upstream MIT notices preserved"
    })
}
