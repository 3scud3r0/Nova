//! Bounded PVM: 16 one-byte instructions, high nibble opcode, low nibble operand.
//! No unbounded jumps or claims of Turing completeness.
use nova_core::{Lineage, Particle, SplitMix64};
#[repr(u8)]
#[derive(Clone, Copy, Debug)]
pub enum Opcode {
    Nop = 0,
    SenseDensity = 1,
    SetAffinity = 2,
    TransduceForce = 3,
    Metabolize = 4,
    Recombine = 5,
}
#[derive(Default, Clone, Copy)]
pub struct Registers {
    pub density: f32,
    pub affinity: f32,
    pub impulse: f32,
    pub drag_resistance: f32,
    pub recombine: bool,
}
pub fn execute(tape: &[u8; 16], density: f32, energy: &mut u32, dt: f32) -> Registers {
    let mut r = Registers {
        density,
        affinity: 1.,
        ..Default::default()
    };
    for &instruction in tape {
        let arg = (instruction & 15) as f32;
        match instruction >> 4 {
            1 => r.density = density,
            2 => r.affinity = (arg - 7.5) / 7.5,
            3 => r.impulse += (arg / 15.) / (1. + r.density),
            4 => {
                let cost = (1. + arg * dt * 100.).ceil() as u32;
                if *energy >= cost {
                    *energy -= cost;
                    r.drag_resistance = (arg / 15.).min(0.9);
                }
            }
            5 => r.recombine = *energy >= 2000,
            _ => (),
        }
    }
    r
}
pub fn crossover(
    a: &Particle,
    b: &Particle,
    la: &Lineage,
    lb: &Lineage,
    tick: u64,
    rng: &mut SplitMix64,
) -> (Particle, Lineage) {
    let cut = 1 + (rng.next_u64() % 15) as usize;
    let mut tape = a.genome_tape;
    tape[cut..].copy_from_slice(&b.genome_tape[cut..]);
    for op in &mut tape {
        if rng.unit() < 0.01 {
            *op = ((rng.next_u64() % 6) as u8) << 4 | ((rng.next_u64() % 16) as u8);
        }
    }
    let mut child = *a;
    for k in 0..3 {
        child.pos_rad[k] = (a.pos_rad[k] + b.pos_rad[k]) * 0.5;
        child.vel_mass[k] = (a.vel_mass[k] * a.vel_mass[3] + b.vel_mass[k] * b.vel_mass[3])
            / (a.vel_mass[3] + b.vel_mass[3]);
    }
    child.vel_mass[3] = (a.vel_mass[3] + b.vel_mass[3]) * 0.1;
    child.phenotype[3] = 2000;
    child.genome_tape = tape;
    let lineage = Lineage::new(
        &tape,
        vec![la.hash.clone(), lb.hash.clone()],
        la.generation.max(lb.generation) + 1,
        tick,
    );
    (child, lineage)
}
