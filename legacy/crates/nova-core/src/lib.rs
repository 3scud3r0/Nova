//! Shared memory contracts. AoS is exactly 64 bytes; hot columns are aligned SoA.
use anyhow::{ensure, Result};
use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[repr(C, align(64))]
#[derive(Clone, Copy, Debug, Pod, Zeroable, Serialize, Deserialize)]
pub struct Particle {
    pub pos_rad: [f32; 4],
    pub vel_mass: [f32; 4],
    pub phenotype: [u32; 4],
    pub genome_tape: [u8; 16],
}
const _: () = assert!(std::mem::size_of::<Particle>() == 64);
#[repr(C, align(16))]
#[derive(Clone, Copy, Debug, Pod, Zeroable)]
pub struct Float4(pub [f32; 4]);
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Lineage {
    pub hash: String,
    pub parents: Vec<String>,
    pub generation: u32,
    pub born_tick: u64,
}
impl Lineage {
    pub fn new(tape: &[u8; 16], parents: Vec<String>, generation: u32, tick: u64) -> Self {
        let mut h = Sha256::new();
        h.update(b"NOVA-LINEAGE-v1");
        h.update(tape);
        for p in &parents {
            h.update(p.as_bytes());
        }
        h.update(generation.to_le_bytes());
        h.update(tick.to_le_bytes());
        Self {
            hash: format!("{:x}", h.finalize()),
            parents,
            generation,
            born_tick: tick,
        }
    }
}
#[derive(Clone, Default)]
pub struct Particles {
    pub positions: Vec<Float4>,
    pub velocities: Vec<Float4>,
    pub phenotypes: Vec<[u32; 4]>,
    pub genomes: Vec<[u8; 16]>,
    pub ids: Vec<u64>,
    pub lineages: Vec<Lineage>,
    next_id: u64,
}
impl Particles {
    pub fn len(&self) -> usize {
        self.positions.len()
    }
    pub fn is_empty(&self) -> bool {
        self.positions.is_empty()
    }
    pub fn push(&mut self, p: Particle, lineage: Lineage) -> Result<u64> {
        ensure!(
            p.pos_rad
                .iter()
                .chain(p.vel_mass.iter())
                .all(|v| v.is_finite()),
            "nonfinite particle"
        );
        ensure!(
            p.pos_rad[3] > 0. && p.vel_mass[3] > 0. && p.phenotype[0] < 8,
            "invalid radius, mass or species"
        );
        let id = self.next_id;
        self.next_id = id
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("particle ID exhausted"))?;
        self.positions.push(Float4(p.pos_rad));
        self.velocities.push(Float4(p.vel_mass));
        self.phenotypes.push(p.phenotype);
        self.genomes.push(p.genome_tape);
        self.ids.push(id);
        self.lineages.push(lineage);
        Ok(id)
    }
    pub fn get(&self, i: usize) -> Particle {
        Particle {
            pos_rad: self.positions[i].0,
            vel_mass: self.velocities[i].0,
            phenotype: self.phenotypes[i],
            genome_tape: self.genomes[i],
        }
    }
    pub fn reorder(&mut self, order: &[usize]) {
        fn permute<T: Clone>(v: &mut Vec<T>, order: &[usize]) {
            *v = order.iter().map(|&i| v[i].clone()).collect();
        }
        permute(&mut self.positions, order);
        permute(&mut self.velocities, order);
        permute(&mut self.phenotypes, order);
        permute(&mut self.genomes, order);
        permute(&mut self.ids, order);
        permute(&mut self.lineages, order);
    }
    pub fn validate(&self) -> Result<()> {
        let n = self.len();
        ensure!(
            [
                self.velocities.len(),
                self.phenotypes.len(),
                self.genomes.len(),
                self.ids.len(),
                self.lineages.len()
            ]
            .iter()
            .all(|&x| x == n),
            "SoA column length mismatch"
        );
        ensure!(
            self.positions
                .iter()
                .chain(&self.velocities)
                .all(|x| x.0.iter().all(|x| x.is_finite())),
            "nonfinite simulation state"
        );
        ensure!(
            self.positions.iter().all(|x| x.0[3] > 0.)
                && self.velocities.iter().all(|x| x.0[3] > 0.)
                && self.phenotypes.iter().all(|x| x[0] < 8),
            "invalid particle"
        );
        Ok(())
    }
}
/// Fixed algorithm, independent of platform RNG implementations.
#[derive(Clone, Copy, Debug)]
pub struct SplitMix64(pub u64);
impl SplitMix64 {
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }
    pub fn unit(&mut self) -> f32 {
        ((self.next_u64() >> 40) as f32) / 16777216.
    }
    pub fn signed(&mut self) -> f32 {
        2. * self.unit() - 1.
    }
}
pub fn norm(v: [f32; 3]) -> f32 {
    (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt()
}
pub fn delta(a: [f32; 4], b: [f32; 4]) -> [f32; 3] {
    [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
}

pub mod recurrent;
