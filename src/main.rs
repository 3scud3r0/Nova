use anyhow::{ensure, Result};
use clap::{Parser, Subcommand, ValueEnum};
use nova_physics::{
    conway::{Conway, Rule},
    mpm::Mpm,
    Config, Universe,
};
use nova_storage::Lake;
use serde_json::json;
use std::{path::PathBuf, time::Instant};
#[derive(Parser)]
#[command(
    name = "nova",
    version,
    about = "Native programmable particle engine and bounded scientific data lake"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}
#[derive(Clone, Copy, Debug, ValueEnum)]
enum Preset {
    CosmicInk,
    ParticleLife,
    ParticleVm,
    LiquidMpm,
}
#[derive(Subcommand)]
enum Command {
    /// Open a native winit/wgpu liquid window. Space pauses, arrows orbit, E emits.
    Live {
        #[arg(long, value_enum, default_value = "cosmic-ink")]
        preset: Preset,
        #[arg(long, default_value_t = 65536)]
        particles: usize,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long)]
        enable_crossover: bool,
        #[arg(long)]
        gpu: bool,
        #[arg(long)]
        output: Option<PathBuf>,
    },
    /// Stream trajectories, symbolic candidates, lineages and field tensors to disk.
    Harvest {
        #[arg(long, default_value_t = 10000)]
        ticks: usize,
        #[arg(long, default_value_t = 4096)]
        particles: usize,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long, default_value = "runs/data_lake")]
        output: PathBuf,
        #[arg(long)]
        record_all: bool,
        #[arg(long, default_value_t = 10)]
        sample_every: usize,
        #[arg(long, default_value_t = 24)]
        grid: usize,
        #[arg(long, default_value_t = 32.)]
        extent: f32,
        #[arg(long, value_enum, default_value = "particle-vm")]
        preset: Preset,
        #[arg(long)]
        enable_crossover: bool,
        #[arg(long)]
        gpu: bool,
    },
    /// Exact integer periodic 2D B/S automaton. Width must be a multiple of 64.
    Conway {
        #[arg(long, default_value = "2048x2048")]
        grid: String,
        #[arg(long, default_value = "B3/S23")]
        rule: String,
        #[arg(long, default_value_t = 100)]
        ticks: usize,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long)]
        benchmark: bool,
    },
    /// Open sparse-grid 3D APIC/MLS-MPM liquid with explicit CFL checks.
    Mpm {
        #[arg(long, default_value_t = 100)]
        ticks: usize,
        #[arg(long, default_value_t = 512)]
        particles: usize,
        #[arg(long, default_value = "runs/mpm-lake")]
        output: PathBuf,
    },
}
fn universe(count: usize, seed: u64, preset: Preset, crossover: bool) -> Result<Universe> {
    ensure!(
        !crossover || matches!(preset, Preset::ParticleVm),
        "crossover requires --preset particle-vm"
    );
    let config = Config {
        seed,
        mpm: matches!(preset, Preset::LiquidMpm),
        dt: if matches!(preset, Preset::LiquidMpm) {
            0.001
        } else {
            1. / 120.
        },
        pvm: matches!(preset, Preset::ParticleVm),
        crossover,
        curl: if matches!(preset, Preset::CosmicInk) {
            0.4
        } else {
            0.
        },
        max_particles: count.saturating_mul(4).max(262144).min(10_000_000),
        ..Default::default()
    };
    Universe::new(count, config)
}
fn main() -> Result<()> {
    match Cli::parse().command.unwrap_or(Command::Live {
        preset: Preset::CosmicInk,
        particles: 8192,
        seed: 42,
        enable_crossover: false,
        gpu: false,
        output: None,
    }) {
        Command::Live {
            preset,
            particles,
            seed,
            enable_crossover,
            gpu,
            output,
        } => {
            let u = universe(particles, seed, preset, enable_crossover)?;
            ensure!(
                !gpu || (!u.config.pvm && !u.config.mpm),
                "GPU backend is canonical/cosmic only; PVM/MPM use CPU"
            );
            #[cfg(feature = "desktop")]
            nova_render::run(u, gpu, output)?;
            #[cfg(not(feature = "desktop"))]
            {
                let _ = (u, gpu, output);
                anyhow::bail!("desktop disabled; build with --features desktop");
            }
        }
        Command::Harvest {
            ticks,
            particles,
            seed,
            output,
            record_all,
            sample_every,
            grid,
            extent,
            preset,
            enable_crossover,
            gpu,
        } => {
            ensure!(
                ticks > 0 && ticks <= 1_000_000_000 && sample_every > 0,
                "invalid tick/sample budget"
            );
            let mut u = universe(particles, seed, preset, enable_crossover)?;
            #[cfg(feature = "gpu")]
            let compute = if gpu {
                Some(nova_gpu::Gpu::new()?)
            } else {
                None
            };
            #[cfg(not(feature = "gpu"))]
            ensure!(!gpu, "GPU disabled in this build");
            ensure!(
                !gpu || (!u.config.pvm && !u.config.mpm),
                "GPU backend is canonical/cosmic only; PVM/MPM use CPU"
            );
            let mut lake = Lake::new(&output, &u, grid, extent)?;
            let start = Instant::now();
            let mut recorded = 0;
            for step in 0..=ticks {
                if step % sample_every == 0 || step == ticks {
                    recorded += lake.record(&u, record_all)? as usize;
                }
                if step == ticks {
                    break;
                }
                #[cfg(feature = "gpu")]
                if let Some(gpu) = &compute {
                    gpu.step(&mut u)?;
                } else {
                    u.step(1)?;
                }
                #[cfg(not(feature = "gpu"))]
                u.step(1)?;
            }
            lake.finish()?;
            println!(
                "{}",
                json!({"output":output,"ticks":u.tick,"frames":recorded,"particles":u.particles.len(),"births":u.births,"elapsed_seconds":start.elapsed().as_secs_f64(),"proof_status":"pending","backend":if gpu{"gpu-with-cpu-spatial-index"}else{"cpu"}})
            );
        }
        Command::Conway {
            grid,
            rule,
            ticks,
            seed,
            benchmark,
        } => {
            ensure!(ticks > 0 && ticks <= 1_000_000_000, "invalid ticks");
            let dimensions: Vec<usize> = grid
                .split('x')
                .map(str::parse)
                .collect::<std::result::Result<_, _>>()?;
            ensure!(dimensions.len() == 2, "expected WIDTHxHEIGHT");
            let mut world = Conway::new(dimensions[0], dimensions[1], Rule::parse(&rule)?, seed)?;
            let start = Instant::now();
            for _ in 0..ticks {
                world.step();
            }
            let seconds = start.elapsed().as_secs_f64();
            println!(
                "{}",
                json!({"rule":rule,"ticks":ticks,"population":world.population(),"periodic":true,"arithmetic":"bitboard integer","seconds":seconds,"cell_updates_per_second":if benchmark{Some(dimensions[0] as f64*dimensions[1] as f64*ticks as f64/seconds)}else{None}})
            );
        }
        Command::Mpm {
            ticks,
            particles,
            output,
        } => {
            ensure!(
                ticks > 0 && ticks <= 1_000_000 && particles > 0 && particles <= 131072,
                "MPM work budget exceeded"
            );
            let mut u = universe(particles, 42, Preset::ParticleLife, false)?;
            // Compact droplet, with total mass matching its initial volume.
            let mut rng = nova_core::SplitMix64(42);
            for i in 0..particles {
                for k in 0..3 {
                    u.particles.positions[i].0[k] = rng.signed() * 0.5;
                    u.particles.velocities[i].0[k] = 0.;
                }
                u.particles.velocities[i].0[3] = 1. / particles as f32;
            }
            let mut mpm = Mpm::new(particles);
            u.config.dt = mpm.dt;
            u.config.mpm = true;
            let mut lake = Lake::new(&output, &u, 24, 4.)?;
            // Record the actual solver, coefficients and units in addition to generic lake metadata.
            std::fs::write(
                output.join("solver.json"),
                serde_json::to_vec_pretty(
                    &json!({"solver":"open-grid APIC MLS-MPM liquid","dt":mpm.dt,"dx":mpm.dx,"bulk":mpm.bulk,"viscosity":mpm.viscosity,"density":mpm.density,"gravity":mpm.gravity,"pressure":"bulk*(J^-4 - 1)","stress_fields":"kinetic coarse-grained; constitutive grid stress is not exported"}),
                )?,
            )?;
            lake.record(&u, true)?;
            for _ in 0..ticks {
                mpm.step(&mut u.particles)?;
                u.tick += 1;
                if u.tick % 10 == 0 || u.tick == ticks as u64 {
                    lake.record(&u, true)?;
                }
            }
            lake.finish()?;
            println!(
                "{}",
                json!({"output":output,"ticks":ticks,"observables":nova_science::observe(&u.particles)})
            );
        }
    }
    Ok(())
}
