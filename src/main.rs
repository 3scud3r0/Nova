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
    Fusion,
    Hunar,
    Realethersim,
    PrimordialDish,
    ParParticleLife,
    Cellflow,
}
#[derive(Subcommand)]
enum Command {
    /// Unified native ports and generator catalog from four pinned upstream repositories.
    Fuse {
        #[arg(long, default_value = "fusion")]
        source: String,
        #[arg(long, default_value_t = 8192)]
        particles: usize,
        #[arg(long, default_value_t = 600)]
        ticks: usize,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long)]
        headless: bool,
        #[arg(long)]
        gpu: bool,
        #[arg(long)]
        output: Option<PathBuf>,
        #[arg(long)]
        settings: Option<PathBuf>,
        #[arg(long)]
        save_settings: Option<PathBuf>,
        #[arg(long)]
        dish_preset: Option<String>,
        #[arg(long)]
        rules: Option<usize>,
        #[arg(long)]
        positions: Option<usize>,
        #[arg(long)]
        palette: Option<usize>,
        #[arg(long)]
        breed_pick: Option<usize>,
        #[arg(long)]
        list: bool,
    },
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
    /// Native 2D/3D Conway, rule-space exploration, CPU bitboards or GPU ping-pong.
    Conway {
        #[arg(long, default_value = "2048x2048")]
        grid: String,
        #[arg(long)]
        rule: Option<String>,
        #[arg(long)]
        source: Option<String>,
        #[arg(long)]
        radius: Option<u32>,
        #[arg(long)]
        gpu: bool,
        #[arg(long)]
        solid_boundaries: bool,
        #[arg(long)]
        pattern: Option<String>,
        #[arg(long)]
        classify: bool,
        #[arg(long)]
        output: Option<PathBuf>,
        #[arg(long)]
        input: Option<PathBuf>,
        #[arg(long)]
        search: Option<usize>,
        #[arg(long, default_value_t = 0)]
        search_start: u64,
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
    let fusion = match preset {
        Preset::Cellflow => Some(nova_fusion::Family::CellFlow),
        Preset::Fusion => Some(nova_fusion::Family::Fusion),
        Preset::Hunar => Some(nova_fusion::Family::Hunar),
        Preset::Realethersim => Some(nova_fusion::Family::Realethersim),
        Preset::PrimordialDish => Some(nova_fusion::Family::PrimordialDish),
        Preset::ParParticleLife => Some(nova_fusion::Family::ParParticleLife),
        _ => None,
    };
    let config = Config {
        fusion,
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
            source,
            radius,
            gpu,
            solid_boundaries,
            pattern,
            classify,
            output,
            input,
            search,
            search_start,
        } => {
            ensure!(
                ticks > 0 && ticks <= 1_000_000,
                "invalid automaton tick budget"
            );
            let source = source.as_deref().unwrap_or("nova");
            ensure!(
                [
                    "nova",
                    "g3dl",
                    "skeeto",
                    "webgol",
                    "randomgamingdev",
                    "bridiro",
                    "catconway"
                ]
                .contains(&source),
                "unknown Conway source profile"
            );
            let dims: Vec<usize> = grid
                .split('x')
                .map(str::parse)
                .collect::<std::result::Result<_, _>>()?;
            ensure!(
                dims.len() == 2 || dims.len() == 3,
                "expected WIDTHxHEIGHT[xDEPTH]"
            );
            let shape = [dims[0], dims[1], if dims.len() == 3 { dims[2] } else { 1 }];
            ensure!(
                source != "g3dl" || dims.len() == 3,
                "g3dl profile requires an explicit 3D --grid, e.g. 64x64x64"
            );
            let expression = rule.unwrap_or_else(|| {
                if source == "g3dl" {
                    "B5/S4-5".into()
                } else {
                    "B3/S23".into()
                }
            });
            // Preserve the existing SIMD bitboard path for ordinary periodic 2D Conway.
            if source == "nova"
                && dims.len() == 2
                && dims[0] % 64 == 0
                && radius.unwrap_or(1) == 1
                && !gpu
                && !solid_boundaries
                && pattern.is_none()
                && !classify
                && output.is_none()
                && input.is_none()
                && search.is_none()
                && Rule::parse(&expression).is_ok()
            {
                let mut world = Conway::new(dims[0], dims[1], Rule::parse(&expression)?, seed)?;
                let started = Instant::now();
                for _ in 0..ticks {
                    world.step();
                }
                let seconds = started.elapsed().as_secs_f64();
                println!(
                    "{}",
                    json!({"rule":expression,"ticks":ticks,"population":world.population(),"periodic":true,"arithmetic":"SIMD bitboard integer","seconds":seconds,"cell_updates_per_second":if benchmark{Some(dims[0] as f64*dims[1] as f64*ticks as f64/seconds)}else{None}})
                );
                return Ok(());
            }
            if let Some(count) = search {
                ensure!(
                    dims.len() == 2 && !gpu,
                    "rule-space search uses the bounded native 2D CPU evaluator"
                );
                let discoveries = nova_automata::analysis::search(
                    shape,
                    radius.unwrap_or(1),
                    search_start,
                    count,
                    ticks,
                    seed,
                )?;
                if let Some(path) = output {
                    use std::io::Write;
                    let mut file = std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(path)?;
                    for record in discoveries {
                        writeln!(file, "{}", serde_json::to_string(&record)?)?;
                    }
                } else {
                    println!("{}", serde_json::to_string(&discoveries)?);
                }
                return Ok(());
            }
            let rules =
                nova_automata::Rules::parse(&expression, dims.len() as u32, radius.unwrap_or(1))?;
            let boundary = if solid_boundaries {
                nova_automata::Boundary::Dead
            } else {
                nova_automata::Boundary::Periodic
            };
            let mut world = if let Some(path) = input {
                nova_automata::Grid::load(path)?
            } else {
                let mut g = nova_automata::Grid::new(shape, rules, boundary)?;
                if let Some(name) = pattern {
                    g.pattern(&name)?;
                } else {
                    g.randomize(seed, 0.2)?;
                }
                g
            };
            let start = Instant::now();
            let mut observer = if classify {
                Some(nova_automata::analysis::Observer::new(world.cells.len())?)
            } else {
                None
            };
            #[cfg(feature = "gpu")]
            let mut adapter: Option<String> = None;
            #[cfg(not(feature = "gpu"))]
            let adapter: Option<String> = None;
            if gpu {
                #[cfg(feature = "gpu")]
                {
                    let mut engine = nova_gpu::automata::GpuAutomaton::new(&world)?;
                    adapter = Some(engine.adapter().to_owned());
                    if observer.is_none() {
                        engine.step(ticks)?;
                    } else {
                        for _ in 0..ticks {
                            let previous = world.cells.clone();
                            engine.step(1)?;
                            world = engine.read()?;
                            let changed = world
                                .cells
                                .iter()
                                .zip(previous)
                                .filter(|(a, b)| **a != *b)
                                .count() as u64;
                            observer.as_mut().unwrap().record(&world, changed)?;
                        }
                    }
                    world = engine.read()?;
                }
                #[cfg(not(feature = "gpu"))]
                anyhow::bail!("GPU support disabled");
            } else {
                for _ in 0..ticks {
                    let stats = world.step()?;
                    if let Some(o) = &mut observer {
                        o.record(&world, stats.changed)?;
                    }
                }
            }
            let seconds = start.elapsed().as_secs_f64();
            if let Some(path) = output {
                if path.extension().is_some_and(|x| x == "rle") {
                    use std::io::Write;
                    let mut f = std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(path)?;
                    f.write_all(nova_automata::rle::export(&world)?.as_bytes())?;
                } else {
                    world.save(path)?;
                }
            }
            let metrics = observer
                .as_ref()
                .map(|o| o.finish(world.rules))
                .transpose()?;
            println!(
                "{}",
                json!({"source_profile":source,"shape":world.shape,"rules":world.rules,"tick":world.tick,"population":world.population(),"backend":if gpu{"native-wgpu"}else{"native-rust"},"gpu_adapter":adapter,"seconds":seconds,"metrics":metrics,"classification_scope":"finite numerical heuristics, not a formal complexity proof","cell_updates_per_second":if benchmark{Some(world.cells.len() as f64*ticks as f64/seconds)}else{None}})
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
        Command::Fuse {
            source,
            particles,
            ticks,
            seed,
            headless,
            gpu,
            output,
            settings,
            save_settings,
            dish_preset,
            rules,
            positions,
            palette,
            breed_pick,
            list,
        } => {
            if list {
                println!("{}", serde_json::to_string_pretty(&nova_fusion::catalog())?);
                return Ok(());
            }
            ensure!(
                ticks > 0 && ticks <= 1_000_000,
                "invalid fusion tick budget"
            );
            let family = nova_fusion::Family::parse(&source)?;
            let mut u = Universe::new(
                particles,
                Config {
                    seed,
                    fusion: Some(family),
                    max_particles: particles.max(262144),
                    ..Default::default()
                },
            )?;
            let model = u.fusion.as_mut().unwrap();
            if let Some(path) = settings {
                ensure!(
                    std::fs::metadata(&path)?.len() <= 1024 * 1024,
                    "preset too large"
                );
                let saved: nova_fusion::SavedPreset =
                    serde_json::from_slice(&std::fs::read(path)?)?;
                saved.validate()?;
                model.settings = saved.settings;
                model.initialize(&mut u.particles, &mut u.matrix, seed)?;
                u.matrix = saved.matrix;
                model.palette = saved.palette;
                u.config.fusion = Some(model.settings.family);
            }
            if let Some(name) = dish_preset {
                model.apply_preset(&mut u.particles, &mut u.matrix, &name)?;
            }
            if rules.is_some() || positions.is_some() || palette.is_some() {
                model.select_generators(
                    &mut u.particles,
                    &mut u.matrix,
                    rules.unwrap_or(0),
                    positions.unwrap_or(0),
                    palette.unwrap_or(0),
                )?;
            }
            if let Some(pick) = breed_pick {
                ensure!(pick < 6, "breed-pick must be 0..5");
                let mate = nova_fusion::breeding::preset("symbiotes")?.matrix8()?;
                let generation = model
                    .rule_history
                    .last()
                    .map(|x| x.generation + 1)
                    .unwrap_or(1);
                let children = nova_fusion::breeding::breed(
                    &u.matrix,
                    &mate,
                    model.settings.species,
                    seed,
                    generation,
                )?;
                u.matrix = children[pick].matrix;
                model.rule_history.push(children[pick].lineage.clone());
            }
            u.config.dt = model.settings.dt;
            if let Some(path) = save_settings {
                std::fs::write(
                    path,
                    serde_json::to_vec_pretty(&nova_fusion::SavedPreset::capture(model, u.matrix))?,
                )?;
            }
            if !headless {
                #[cfg(feature = "desktop")]
                {
                    nova_render::run(u, gpu, output)?;
                    return Ok(());
                }
                #[cfg(not(feature = "desktop"))]
                anyhow::bail!("desktop disabled; use --headless");
            }
            #[cfg(feature = "gpu")]
            let compute = if gpu {
                Some(nova_gpu::Gpu::new()?)
            } else {
                None
            };
            #[cfg(not(feature = "gpu"))]
            ensure!(!gpu, "GPU disabled");
            let extent = u
                .fusion
                .as_ref()
                .unwrap()
                .settings
                .half_extent
                .into_iter()
                .fold(0., f32::max)
                * 1.01;
            let mut lake = output
                .as_ref()
                .map(|path| Lake::new(path, &u, 24, extent))
                .transpose()?;
            let start = Instant::now();
            for _ in 0..ticks {
                #[cfg(feature = "gpu")]
                if let Some(g) = &compute {
                    g.step(&mut u)?;
                } else {
                    u.step(1)?;
                }
                #[cfg(not(feature = "gpu"))]
                u.step(1)?;
                if u.tick % 10 == 0 || u.tick == ticks as u64 {
                    if let Some(lake) = &mut lake {
                        lake.record(&u, true)?;
                    }
                }
            }
            if let Some(lake) = lake {
                lake.finish()?;
            }
            #[cfg(feature = "gpu")]
            let adapter_name = compute.as_ref().map(|c| c.adapter.clone());
            #[cfg(not(feature = "gpu"))]
            let adapter_name: Option<String> = None;
            let elapsed = start.elapsed().as_secs_f64();
            println!(
                "{}",
                serde_json::json!({"source":u.config.fusion,"particles":particles,"ticks":u.tick,"backend":if gpu{"gpu"}else{"rust-rayon"},"gpu_adapter":adapter_name,"elapsed_seconds":elapsed,"particle_updates_per_second":particles as f64*ticks as f64/elapsed,"statistics":u.fusion.as_ref().unwrap().stats,"observables":nova_science::observe(&u.particles),"output":output})
            );
        }
    }
    Ok(())
}
