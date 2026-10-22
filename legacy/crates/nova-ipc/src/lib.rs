//! File-backed shared-memory frame slots with explicit reader/writer leases.
//! Frames are binary floats; JSON is only small publication metadata.
use anyhow::{ensure, Context, Result};
use memmap2::MmapMut;
use nova_substrates::{Action, EnvironmentSpec, Registry, TensorView};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
const HEADER: usize = 64;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Manifest {
    pub schema: String,
    pub sequence: u64,
    pub slot: usize,
    pub slots: usize,
    pub tick: u64,
    pub shape: [usize; 4],
    pub bytes: usize,
    pub environment: EnvironmentSpec,
    pub particle_count: usize,
    pub particle_width: usize,
    pub particle_ids: bool,
    pub time_step: f32,
}
struct Lease {
    path: PathBuf,
}
impl Drop for Lease {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}
fn lease(path: PathBuf) -> Result<Option<Lease>> {
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut f) => {
            write!(f, "{}", std::process::id())?;
            Ok(Some(Lease { path }))
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(None),
        Err(e) => Err(e.into()),
    }
}
pub struct Publisher {
    root: PathBuf,
    slots: usize,
    sequence: u64,
    environment: EnvironmentSpec,
    time_step: f32,
    _session: Lease,
}
fn atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    let mut f = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
    let result = (|| -> Result<()> {
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
impl Publisher {
    pub fn new(
        root: &Path,
        slots: usize,
        environment: EnvironmentSpec,
        time_step: f32,
    ) -> Result<Self> {
        ensure!(
            time_step.is_finite() && time_step > 0.,
            "invalid IPC time step"
        );
        ensure!((2..=32).contains(&slots), "IPC ring requires 2..32 slots");
        environment.validate()?;
        fs::create_dir_all(root)?;
        let session = lease(root.join("publisher.lock"))?.context(
            "another publisher owns this directory; inspect PID before removing a stale lease",
        )?;
        ensure!(
            !root.join("ring.json").exists(),
            "IPC directory already has a session; use a new directory"
        );
        Ok(Self {
            root: root.into(),
            slots,
            sequence: 0,
            environment,
            time_step,
            _session: session,
        })
    }
    pub fn publish(
        &mut self,
        view: TensorView<'_>,
        particles: Option<&nova_core::Particles>,
        timeout: Duration,
    ) -> Result<u64> {
        ensure!(
            view.shape[0] == 4
                && view.shape.iter().all(|&x| x > 0)
                && view.shape.iter().try_fold(1usize, |a, &b| a.checked_mul(b))
                    == Some(view.values.len())
                && view.values.len() <= 8_388_608
                && view.values.iter().all(|x| x.is_finite()),
            "invalid IPC tensor"
        );
        let deadline = Instant::now() + timeout;
        let (slot, _lease) = loop {
            let mut chosen = None;
            for offset in 0..self.slots {
                let slot = (self.sequence as usize + offset) % self.slots;
                if let Some(guard) = lease(self.root.join(format!("slot-{slot}.lock")))? {
                    chosen = Some((slot, guard));
                    break;
                }
            }
            if let Some(pair) = chosen {
                break pair;
            }
            ensure!(
                Instant::now() < deadline,
                "all frame slots pinned by readers"
            );
            std::thread::sleep(Duration::from_millis(2));
        };
        self.sequence = self
            .sequence
            .checked_add(1)
            .context("IPC sequence overflow")?;
        let particle_count = particles.map(|p| p.len()).unwrap_or(0);
        ensure!(particle_count <= 262144, "IPC particle budget exceeded");
        if let Some(p) = particles {
            p.validate()?;
        }
        let bytes = HEADER + view.values.len() * 4 + particle_count * (8 * 4 + 8);
        let path = self.root.join(format!("slot-{slot}.bin"));
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&path)?;
        file.set_len(bytes as u64)?;
        // SAFETY: the exclusive slot lease prevents all cooperating processes from
        // mapping/overwriting this file until publication and guard release.
        let mut mapped = unsafe { MmapMut::map_mut(&file)? };
        mapped[..HEADER].fill(0);
        mapped[..8].copy_from_slice(b"NOVAFR09");
        mapped[8..16].copy_from_slice(&self.sequence.to_le_bytes());
        mapped[16..24].copy_from_slice(&view.tick.to_le_bytes());
        for (k, d) in view.shape.iter().enumerate() {
            mapped[24 + k * 4..28 + k * 4].copy_from_slice(&(*d as u32).to_le_bytes());
        }
        mapped[40..48].copy_from_slice(&(view.values.len() as u64).to_le_bytes());
        mapped[48..52].copy_from_slice(&(particle_count as u32).to_le_bytes());
        mapped[52..56].copy_from_slice(&8u32.to_le_bytes());
        mapped[56..60].copy_from_slice(&u32::from(particles.is_some()).to_le_bytes());
        for (chunk, value) in mapped[HEADER..HEADER + view.values.len() * 4]
            .chunks_exact_mut(4)
            .zip(view.values)
        {
            chunk.copy_from_slice(&value.to_le_bytes());
        }
        if let Some(p) = particles {
            for i in 0..p.len() {
                let values = [
                    p.positions[i].0[0],
                    p.positions[i].0[1],
                    p.positions[i].0[2],
                    p.velocities[i].0[0],
                    p.velocities[i].0[1],
                    p.velocities[i].0[2],
                    p.velocities[i].0[3],
                    p.phenotypes[i][0] as f32,
                ];
                let offset = HEADER + view.values.len() * 4 + i * 32;
                for (chunk, value) in mapped[offset..offset + 32].chunks_exact_mut(4).zip(values) {
                    chunk.copy_from_slice(&value.to_le_bytes());
                }
            }
        }
        if let Some(p) = particles {
            let offset = HEADER + view.values.len() * 4 + particle_count * 32;
            for (chunk, id) in mapped[offset..].chunks_exact_mut(8).zip(&p.ids) {
                chunk.copy_from_slice(&id.to_le_bytes());
            }
        }
        mapped.flush()?;
        drop(mapped);
        drop(file);
        let manifest = Manifest {
            schema: "NOVA-RING-v1".into(),
            sequence: self.sequence,
            slot,
            slots: self.slots,
            tick: view.tick,
            shape: view.shape,
            bytes,
            environment: self.environment.clone(),
            particle_count,
            particle_width: 8,
            particle_ids: particles.is_some(),
            time_step: self.time_step,
        };
        atomic(
            &self.root.join("ring.json"),
            &serde_json::to_vec(&manifest)?,
        )?;
        Ok(self.sequence)
    }
    pub fn await_action(&self, sequence: u64, timeout: Duration) -> Result<Command> {
        let start = Instant::now();
        loop {
            let path = self.root.join("action.bin");
            if path.exists() {
                ensure!(
                    fs::metadata(&path)?.len() == 64,
                    "invalid action packet length"
                );
                let data = fs::read(path)?;
                let command = Command::decode(&data)?;
                if command.sequence == sequence {
                    return Ok(command);
                }
                ensure!(
                    command.sequence < sequence,
                    "action is ahead of published observation"
                );
            }
            ensure!(
                start.elapsed() < timeout,
                "timed out waiting for cortex action"
            );
            std::thread::sleep(Duration::from_millis(2));
        }
    }
}
pub struct Command {
    pub sequence: u64,
    pub close: bool,
    pub action: Option<Action>,
}
impl Command {
    pub fn decode(data: &[u8]) -> Result<Self> {
        ensure!(
            data.len() == 64
                && &data[..8] == b"NOVAAC09"
                && crc32fast::hash(&data[..60]) == u32::from_le_bytes(data[60..64].try_into()?),
            "action magic/checksum mismatch"
        );
        let sequence = u64::from_le_bytes(data[8..16].try_into()?);
        let opcode = u32::from_le_bytes(data[16..20].try_into()?);
        let values = std::array::from_fn::<_, 8, _>(|i| {
            f32::from_le_bytes(data[20 + i * 4..24 + i * 4].try_into().unwrap())
        });
        ensure!(
            values.iter().all(|x| x.is_finite()),
            "nonfinite action packet"
        );
        let action = match opcode {
            0 | 3 => None,
            1 => Some(Action::Paint {
                position: [values[0], values[1], values[2]],
                radius: values[3],
                strength: values[4],
            }),
            2 => Some(Action::Impulse {
                position: [values[0], values[1], values[2]],
                radius: values[3],
                vector: [values[5], values[6], values[7]],
            }),
            _ => anyhow::bail!("unknown action opcode"),
        };
        if let Some(a) = &action {
            a.validate()?;
        }
        Ok(Self {
            sequence,
            close: opcode == 3,
            action,
        })
    }
}
pub fn serve(
    root: &Path,
    spec: EnvironmentSpec,
    slots: usize,
    ticks: usize,
    timeout: Duration,
    output: Option<&Path>,
) -> Result<()> {
    ensure!(
        ticks > 0
            && ticks <= 1_000_000_000
            && timeout > Duration::ZERO
            && timeout <= Duration::from_secs(86400),
        "invalid IPC workload budget"
    );
    let mut world = Registry::default().build(&spec)?;
    let mut lake = output
        .map(|path| nova_storage::tensors::TensorLake::new(path, &spec, world.observe()))
        .transpose()?;
    let mut publisher = Publisher::new(root, slots, spec, world.time_step())?;
    for _ in 0..ticks {
        let sequence = publisher.publish(world.observe(), world.particle_view(), timeout)?;
        let command = publisher.await_action(sequence, timeout)?;
        if let Some(lake) = &mut lake {
            lake.record(world.observe(), command.action.as_ref())?;
        }
        if command.close {
            break;
        }
        if let Some(action) = command.action {
            world.interact(&action)?;
        }
        world.step(1)?;
    }
    if let Some(lake) = lake {
        lake.finish()?;
    }
    Ok(())
}

impl Drop for Publisher {
    fn drop(&mut self) {
        let _ = fs::write(
            self.root.join("closed.json"),
            format!("{{\"sequence\":{},\"status\":\"closed\"}}", self.sequence),
        );
    }
}
