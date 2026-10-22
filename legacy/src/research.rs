//! Headless research commands; no workload is executed during compilation.
use anyhow::{ensure, Result};
use clap::Subcommand;
use nova_cognition::{Observer, ObserverConfig};
use nova_evolution::{EvaluationConfig, SearchConfig};
use nova_storage::tensors::TensorLake;
use nova_substrates::{EnvironmentSpec, Registry};
use std::{
    io::Write,
    path::{Path, PathBuf},
};
#[derive(Subcommand)]
pub enum Command {
    /// Publish binary observation slots and wait for matching cortex actions.
    Ipc {
        #[arg(long)]
        directory: PathBuf,
        #[arg(long)]
        output: Option<PathBuf>,
        #[arg(long, default_value = "conway")]
        substrate: String,
        #[arg(long)]
        spec: Option<PathBuf>,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long, default_value_t = 1000000)]
        ticks: usize,
        #[arg(long, default_value_t = 3)]
        slots: usize,
        #[arg(long, default_value_t = 3600)]
        action_timeout: u64,
    },
    /// List compiled substrate plugins.
    Substrates,
    /// Advance any substrate and optionally record common tensors.
    Substrate {
        #[arg(long, default_value = "conway")]
        kind: String,
        #[arg(long)]
        live: bool,
        #[arg(long)]
        spec: Option<PathBuf>,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long, default_value_t = 512)]
        ticks: usize,
        #[arg(long)]
        neural: bool,
        #[arg(long)]
        output: Option<PathBuf>,
    },
    /// Resumable MAP-Elites islands, with entropy/autocorrelation niches.
    Autosearch {
        #[arg(long)]
        target_archive: PathBuf,
        #[arg(long, default_value = "fusion")]
        substrate: String,
        #[arg(long)]
        spec: Option<PathBuf>,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long, default_value_t = 4)]
        islands: usize,
        #[arg(long, default_value_t = 10)]
        epochs: usize,
        #[arg(long, default_value_t = 8)]
        candidates: usize,
        #[arg(long, default_value_t = 512)]
        ticks: usize,
        #[arg(long, default_value_t = 16)]
        bins: usize,
        #[arg(long)]
        neural: bool,
        #[arg(long)]
        interventions: bool,
        #[arg(long)]
        no_observer: bool,
    },
    /// Online recurrent prediction, motor intervention, and synthetic replay.
    Observe {
        #[arg(long, default_value = "conway")]
        substrate: String,
        #[arg(long)]
        spec: Option<PathBuf>,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long, default_value_t = 1024)]
        ticks: usize,
        #[arg(long, default_value_t = 128)]
        sleep_every: u64,
        #[arg(long)]
        passive: bool,
        #[arg(long)]
        output: PathBuf,
    },
    /// Exact polynomial Lie certificate, or the embedded Lean pair identity.
    Verify {
        #[arg(
            long,
            conflicts_with = "lean_project",
            required_unless_present = "lean_project"
        )]
        claim: Option<PathBuf>,
        #[arg(long, conflicts_with = "claim")]
        lean_project: Option<PathBuf>,
        #[arg(long)]
        share_directory: Option<PathBuf>,
        #[arg(long)]
        output: PathBuf,
    },
    /// Exchange content-addressed discoveries with explicitly configured peers.
    Swarm {
        #[arg(long)]
        directory: PathBuf,
        #[arg(long)]
        identity: PathBuf,
        #[arg(long, default_value = "/ip4/127.0.0.1/tcp/0")]
        listen: String,
        #[arg(long)]
        peer: Vec<String>,
        #[arg(long, default_value_t = 300)]
        seconds: u64,
    },
    /// Policy search over invariant term masks; only exact verified claims earn +1.
    Rlvr {
        #[arg(long)]
        claim: PathBuf,
        #[arg(long, default_value_t = 128)]
        steps: usize,
        #[arg(long, default_value_t = 42)]
        seed: u64,
        #[arg(long)]
        output: PathBuf,
    },
}
fn read_bounded(path: &Path, max: u64) -> Result<Vec<u8>> {
    ensure!(
        std::fs::metadata(path)?.len() <= max,
        "input file budget exceeded"
    );
    Ok(std::fs::read(path)?)
}
fn spec(kind: &str, seed: u64, path: Option<PathBuf>) -> Result<EnvironmentSpec> {
    let s = if let Some(path) = path {
        serde_json::from_slice(&read_bounded(&path, 1024 * 1024)?)?
    } else {
        EnvironmentSpec::for_kind(kind, seed)
    };
    s.validate()?;
    Ok(s)
}
fn write_new(path: &Path, value: &impl serde::Serialize) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(&serde_json::to_vec_pretty(value)?)?;
    Ok(())
}
pub fn run(command: Command) -> Result<()> {
    match command {
        Command::Ipc {
            directory,
            output,
            substrate,
            spec: path,
            seed,
            ticks,
            slots,
            action_timeout,
        } => {
            nova_ipc::serve(
                &directory,
                spec(&substrate, seed, path)?,
                slots,
                ticks,
                std::time::Duration::from_secs(action_timeout),
                output.as_deref(),
            )?;
        }
        Command::Substrates => println!("{}", serde_json::to_string(&Registry::default().names())?),
        Command::Substrate {
            kind,
            live,
            spec: path,
            seed,
            ticks,
            neural,
            output,
        } => {
            ensure!(ticks > 0 && ticks <= 1_000_000, "tick budget");
            let mut s = spec(&kind, seed, path)?;
            if neural {
                s.neural = Some(Default::default());
            }
            if live {
                ensure!(
                    output.is_none(),
                    "use headless mode to record a tensor lake"
                );
                #[cfg(feature = "desktop")]
                {
                    return nova_render::substrate::run(s);
                }
                #[cfg(not(feature = "desktop"))]
                {
                    anyhow::bail!("native live view requires --features desktop");
                }
            }
            let mut world = Registry::default().build(&s)?;
            let mut lake = output
                .as_ref()
                .map(|p| TensorLake::new(p, &s, world.observe()))
                .transpose()?;
            if let Some(l) = &mut lake {
                l.record(world.observe(), None)?;
            }
            if let Some(l) = &mut lake {
                for _ in 0..ticks {
                    world.step(1)?;
                    l.record(world.observe(), None)?;
                }
            } else {
                world.step(ticks)?;
            }
            if let Some(l) = lake {
                l.finish()?;
            }
            println!(
                "{}",
                serde_json::json!({"substrate":world.name(),"tick":world.observe().tick,"shape":world.observe().shape,"output":output})
            );
        }
        Command::Autosearch {
            target_archive,
            substrate,
            spec: path,
            seed,
            islands,
            epochs,
            candidates,
            ticks,
            bins,
            neural,
            interventions,
            no_observer,
        } => {
            let initial = spec(&substrate, seed, path)?;
            let evaluation = EvaluationConfig {
                ticks,
                warmup: 32.min(ticks.saturating_sub(1)),
                sample_every: 4.min(ticks).max(1),
                observer: !no_observer,
                interventions,
                ..Default::default()
            };
            let config = SearchConfig {
                seed,
                islands,
                epochs,
                candidates_per_epoch: candidates,
                bins,
                neural,
                evaluation,
                ..Default::default()
            };
            println!(
                "{}",
                serde_json::to_string(&nova_evolution::search(&target_archive, initial, config)?)?
            );
        }
        Command::Observe {
            substrate,
            spec: path,
            seed,
            ticks,
            sleep_every,
            passive,
            output,
        } => {
            ensure!(ticks > 0 && ticks <= 1_000_000, "tick budget");
            let s = spec(&substrate, seed, path)?;
            let mut world = Registry::default().build(&s)?;
            let mut observer = Observer::new(ObserverConfig {
                seed,
                sleep_every,
                ..Default::default()
            })?;
            let mut lake = TensorLake::new(&output, &s, world.observe())?;
            let mut reports =
                std::io::BufWriter::new(std::fs::File::create(output.join("observer.jsonl"))?);
            for _ in 0..ticks {
                let action = observer.observe(world.observe(), !passive)?;
                lake.record(world.observe(), action.as_ref())?;
                writeln!(reports, "{}", serde_json::to_string(&observer.report)?)?;
                if let Some(a) = action {
                    world.interact(&a)?;
                }
                world.step(1)?;
            }
            lake.record(world.observe(), None)?;
            lake.finish()?;
            reports.flush()?;
            write_new(&output.join("world-model.json"), &observer.model)?;
            println!("{}", serde_json::to_string(&observer.report)?);
        }
        Command::Verify {
            claim,
            lean_project,
            share_directory,
            output,
        } => {
            let claim_path_for_share = claim.clone();
            let receipt = if let Some(path) = claim {
                let claim = serde_json::from_slice(&read_bounded(&path, 1024 * 1024)?)?;
                nova_science::verification::verify_lie(&claim)?
            } else {
                nova_science::verification::verify_pair_lean(
                    &lean_project.unwrap(),
                    std::time::Duration::from_secs(120),
                )?
            };
            write_new(&output, &receipt)?;
            if let Some(directory) = share_directory {
                ensure!(
                    receipt.method == "exact-rational-polynomial-Lie" && receipt.reward == 1,
                    "only locally verified polynomial claims can be shared"
                );
                let claim: nova_science::verification::PolynomialClaim =
                    serde_json::from_slice(&read_bounded(
                        &claim_path_for_share
                            .ok_or_else(|| anyhow::anyhow!("claim required for sharing"))?,
                        1024 * 1024,
                    )?)?;
                write_new(
                    &directory
                        .join("proof-outbox")
                        .join(format!("{}.json", receipt.claim_sha256)),
                    &serde_json::json!({"kind":"proof","claim":claim,"receipt":receipt}),
                )?;
            }
            println!("{}", serde_json::to_string(&receipt)?);
        }
        Command::Swarm {
            directory,
            identity,
            listen,
            peer,
            seconds,
        } => {
            #[cfg(feature = "swarm")]
            {
                let config = nova_swarm::SwarmConfig {
                    directory,
                    identity,
                    listen: listen.parse()?,
                    peers: peer.iter().map(|x| x.parse()).collect::<Result<_, _>>()?,
                    seconds,
                    interval: 10,
                    max_received: 4096,
                };
                let report = tokio::runtime::Runtime::new()?.block_on(nova_swarm::run(config))?;
                println!("{}", serde_json::to_string(&report)?);
            }
            #[cfg(not(feature = "swarm"))]
            {
                let _ = (directory, identity, listen, peer, seconds);
                anyhow::bail!("build with --features swarm for native P2P");
            }
        }
        Command::Rlvr {
            claim,
            steps,
            seed,
            output,
        } => {
            ensure!(steps > 0 && steps <= 10000, "proof search budget");
            let template: nova_science::verification::PolynomialClaim =
                serde_json::from_slice(&read_bounded(&claim, 1024 * 1024)?)?;
            ensure!(
                template.invariant.len() >= 2 && template.invariant.len() <= 64,
                "proof policy requires 2..64 template terms"
            );
            let mut probability = vec![0.8f32; template.invariant.len()];
            let mut rng = nova_core::SplitMix64(seed);
            if let Some(parent) = output.parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(parent)?;
                }
            }
            let mut file = std::io::BufWriter::new(
                std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(output)?,
            );
            for step in 0..steps {
                let mask: Vec<_> = probability.iter().map(|&p| rng.unit() < p).collect();
                let mut proposal = template.clone();
                proposal.invariant = template
                    .invariant
                    .iter()
                    .zip(&mask)
                    .filter(|(_, keep)| **keep)
                    .map(|(t, _)| t.clone())
                    .collect();
                let receipt = nova_science::verification::verify_nontrivial_lie(&proposal)?;
                let reward = receipt.reward as f32;
                for (p, &selected) in probability.iter_mut().zip(&mask) {
                    *p =
                        (*p + 0.05 * (reward - 0.1) * (f32::from(selected) - *p)).clamp(0.05, 0.95);
                }
                writeln!(
                    file,
                    "{}",
                    serde_json::json!({"step":step,"claim":proposal,"receipt":receipt,"term_probabilities":probability})
                )?;
            }
            file.flush()?;
        }
    }
    Ok(())
}
