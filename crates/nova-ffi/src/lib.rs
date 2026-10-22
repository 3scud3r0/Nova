//! C ABI. Pointer validity, ownership and synchronization are caller obligations.
use nova_core::{Lineage, Particle};
use nova_physics::{Config, Universe};
use std::{
    cell::RefCell,
    ffi::c_char,
    panic::{catch_unwind, AssertUnwindSafe},
    ptr,
};
pub struct NovaHandle {
    universe: Universe,
}
/// Portable 64-byte C transfer record; native SoA storage has separate alignment.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct NovaParticle {
    pub pos_rad: [f32; 4],
    pub vel_mass: [f32; 4],
    pub phenotype: [u32; 4],
    pub genome_tape: [u8; 16],
}
const _: () = assert!(std::mem::size_of::<NovaParticle>() == 64);
thread_local! {static LAST_ERROR:RefCell<String>=const{RefCell::new(String::new())};}
fn boundary(f: impl FnOnce() -> Result<(), String>) -> i32 {
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(Ok(())) => {
            LAST_ERROR.with(|e| e.borrow_mut().clear());
            0
        }
        Ok(Err(e)) => {
            LAST_ERROR.with(|s| *s.borrow_mut() = e);
            -1
        }
        Err(_) => {
            LAST_ERROR.with(|s| *s.borrow_mut() = "Rust panic at ABI boundary".into());
            -2
        }
    }
}
/// Creates an owned handle. preset: 0=canonical, 1=cosmic ink, 2=PVM, 3=liquid MPM.
/// # Safety
/// out must point to a writable handle slot. Free a successful result exactly once.
#[no_mangle]
pub unsafe extern "C" fn nova_create(
    count: usize,
    seed: u64,
    preset: u32,
    crossover: bool,
    out: *mut *mut NovaHandle,
) -> i32 {
    boundary(|| {
        if out.is_null() {
            return Err("null output pointer".into());
        }
        unsafe {
            *out = ptr::null_mut();
        }
        let mut config = Config {
            seed,
            ..Default::default()
        };
        match preset {
            0 => (),
            1 => config.curl = 0.4,
            2 => {
                config.pvm = true;
                config.crossover = crossover;
            }
            3 => {
                config.mpm = true;
                config.dt = 0.001;
            }
            _ => return Err("unknown preset".into()),
        }
        if crossover && !config.pvm {
            return Err("crossover requires PVM".into());
        }
        let universe = Universe::new(count, config).map_err(|e| e.to_string())?;
        unsafe {
            *out = Box::into_raw(Box::new(NovaHandle { universe }));
        }
        Ok(())
    })
}
/// # Safety
/// handle must be live and exclusively owned for this call; no concurrent array reads.
#[no_mangle]
pub unsafe extern "C" fn nova_step(handle: *mut NovaHandle, ticks: usize) -> i32 {
    boundary(|| {
        let h = unsafe { handle.as_mut() }.ok_or("null handle")?;
        h.universe.step(ticks).map_err(|e| e.to_string())
    })
}
/// # Safety
/// handle must be live, exclusively owned and not previously freed. Null is allowed.
#[no_mangle]
pub unsafe extern "C" fn nova_destroy(handle: *mut NovaHandle) {
    if !handle.is_null() {
        let _ = catch_unwind(AssertUnwindSafe(|| unsafe { drop(Box::from_raw(handle)) }));
    }
}
/// Borrow float4 positions/radius. Pointer remains valid only until next mutation or destroy.
/// # Safety
/// handle must be live; data and count writable. Do not mutate or free returned memory.
#[no_mangle]
pub unsafe extern "C" fn nova_positions(
    handle: *const NovaHandle,
    data: *mut *const f32,
    count: *mut usize,
) -> i32 {
    boundary(|| {
        let h = unsafe { handle.as_ref() }.ok_or("null handle")?;
        if data.is_null() || count.is_null() {
            return Err("null output".into());
        }
        unsafe {
            *data = h.universe.particles.positions.as_ptr().cast();
            *count = h.universe.particles.len();
        }
        Ok(())
    })
}
/// # Safety
/// Same lifetime and synchronization contract as nova_positions.
#[no_mangle]
pub unsafe extern "C" fn nova_velocities(
    handle: *const NovaHandle,
    data: *mut *const f32,
    count: *mut usize,
) -> i32 {
    boundary(|| {
        let h = unsafe { handle.as_ref() }.ok_or("null handle")?;
        if data.is_null() || count.is_null() {
            return Err("null output".into());
        }
        unsafe {
            *data = h.universe.particles.velocities.as_ptr().cast();
            *count = h.universe.particles.len();
        }
        Ok(())
    })
}
/// Inject a custom 64-byte particle record. The C struct need not be 64-byte aligned.
/// # Safety
/// handle exclusively live; particle points to 64 readable bytes in native C layout.
#[no_mangle]
pub unsafe extern "C" fn nova_inject(
    handle: *mut NovaHandle,
    particle: *const NovaParticle,
) -> i32 {
    boundary(|| {
        let h = unsafe { handle.as_mut() }.ok_or("null handle")?;
        if particle.is_null() {
            return Err("null particle".into());
        }
        let raw = unsafe { ptr::read_unaligned(particle) };
        let p = Particle {
            pos_rad: raw.pos_rad,
            vel_mass: raw.vel_mass,
            phenotype: raw.phenotype,
            genome_tape: raw.genome_tape,
        };
        if h.universe.config.mpm {
            return Err("MPM membership is fixed for a run".into());
        }
        if h.universe.particles.len() >= h.universe.config.max_particles {
            return Err("particle capacity exceeded".into());
        }
        h.universe
            .particles
            .push(p, Lineage::new(&p.genome_tape, vec![], 0, h.universe.tick))
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}
/// Returns required bytes including NUL. Copies at most capacity bytes of last thread-local error.
/// # Safety
/// If nonnull, destination must be writable for capacity bytes.
#[no_mangle]
pub unsafe extern "C" fn nova_last_error(destination: *mut c_char, capacity: usize) -> usize {
    LAST_ERROR.with(|e| {
        let e = e.borrow();
        let bytes = e.as_bytes();
        if !destination.is_null() && capacity > 0 {
            let n = bytes.len().min(capacity - 1);
            unsafe {
                ptr::copy_nonoverlapping(bytes.as_ptr(), destination.cast(), n);
                *destination.add(n) = 0;
            }
        }
        bytes.len() + 1
    })
}
