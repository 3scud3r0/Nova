//! Explicit-peer encrypted libp2p gossip. Received scores/proofs remain untrusted.
pub mod coherence;
use anyhow::{ensure, Result};
use futures::StreamExt;
use libp2p::{gossipsub, identity, noise, swarm::SwarmEvent, tcp, yamux, Multiaddr, SwarmBuilder};
use nova_evolution::Elite;
use nova_science::verification::{PolynomialClaim, Receipt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Discovery {
    Section {
        section: coherence::Section,
    },
    Elite {
        elite: Elite,
    },
    Proof {
        claim: PolynomialClaim,
        receipt: Receipt,
    },
}
impl Discovery {
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::Section { section } => section.validate()?,
            Self::Elite { elite } => {
                elite.validate()?;
                ensure!(elite.metrics.quality > 0., "nonelite publication");
            }
            Self::Proof { claim, receipt } => {
                receipt.validate()?;
                let local = nova_science::verification::verify_lie(claim)?;
                ensure!(
                    receipt.method == local.method
                        && receipt.claim_sha256 == local.claim_sha256
                        && receipt.reward == 1
                        && local.reward == 1,
                    "remote polynomial proof did not verify locally"
                );
            }
        }
        Ok(())
    }
}
#[derive(Clone)]
pub struct SwarmConfig {
    pub directory: PathBuf,
    pub identity: PathBuf,
    pub listen: Multiaddr,
    pub peers: Vec<Multiaddr>,
    pub seconds: u64,
    pub interval: u64,
    pub max_received: usize,
}
#[derive(Default, Serialize)]
pub struct SwarmReport {
    pub peer_id: String,
    pub accepted: usize,
    pub rejected: usize,
    pub published: usize,
    pub overlap_conflicts: usize,
    pub peer_dial_failures: usize,
}
fn identity(path: &Path) -> Result<identity::Keypair> {
    if path.exists() {
        ensure!(
            std::fs::metadata(path)?.len() < 4096,
            "identity file too large"
        );
        return Ok(identity::Keypair::from_protobuf_encoding(&std::fs::read(
            path,
        )?)?);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let key = identity::Keypair::generate_ed25519();
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    options
        .open(path)?
        .write_all(&key.to_protobuf_encoding()?)?;
    Ok(key)
}
pub async fn run(config: SwarmConfig) -> Result<SwarmReport> {
    ensure!(
        config.seconds > 0
            && config.seconds <= 86400
            && config.interval > 0
            && config.interval <= 3600
            && config.peers.len() <= 128
            && config.max_received > 0
            && config.max_received <= 100000,
        "invalid swarm budget"
    );
    std::fs::create_dir_all(config.directory.join("inbox"))?;
    std::fs::create_dir_all(config.directory.join("proof-inbox"))?;
    std::fs::create_dir_all(config.directory.join("proof-outbox"))?;
    let key = identity(&config.identity)?;
    let mut report = SwarmReport {
        peer_id: key.public().to_peer_id().to_string(),
        ..Default::default()
    };
    let settings = gossipsub::ConfigBuilder::default()
        .heartbeat_interval(Duration::from_secs(2))
        .max_transmit_size(1024 * 1024)
        .validation_mode(gossipsub::ValidationMode::Strict)
        .build()
        .map_err(|e| anyhow::anyhow!("{e}"))?;
    let behaviour: gossipsub::Behaviour = gossipsub::Behaviour::new(
        gossipsub::MessageAuthenticity::Signed(key.clone()),
        settings,
    )
    .map_err(anyhow::Error::msg)?;
    let mut swarm = SwarmBuilder::with_existing_identity(key)
        .with_tokio()
        .with_tcp(
            tcp::Config::default().nodelay(true),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_behaviour(|_| behaviour)?
        .build();
    let topic = gossipsub::IdentTopic::new("nova-discoveries-v1");
    swarm.behaviour_mut().subscribe(&topic)?;
    swarm.listen_on(config.listen)?;
    for peer in config.peers {
        if swarm.dial(peer).is_err() {
            report.peer_dial_failures += 1;
        }
    }
    let mut timer = tokio::time::interval(Duration::from_secs(config.interval));
    let end = tokio::time::sleep(Duration::from_secs(config.seconds));
    tokio::pin!(end);
    let mut coherence = coherence::CoherenceGraph::default();
    let mut sent = std::collections::BTreeSet::new();
    loop {
        tokio::select! {
            _ = &mut end => break,
            _ = timer.tick() => publish_pending(&mut swarm, &topic, &config.directory, &mut sent, &mut report)?,
            event = swarm.select_next_some() => {
                match event {
                    SwarmEvent::Behaviour(gossipsub::Event::Message { message, .. }) => {
                        if report.accepted + report.rejected >= config.max_received { break; }
                        receive(&config.directory, &message.data, &mut coherence, &mut report)?;
                    }
                    SwarmEvent::NewListenAddr { address, .. } => {
                        eprintln!("NOVA peer {} listening on {}", report.peer_id, address);
                    }
                    SwarmEvent::OutgoingConnectionError { .. } => report.peer_dial_failures += 1,
                    _ => {}
                }
            }
        }
    }
    Ok(report)
}

fn publish_pending(
    swarm: &mut libp2p::Swarm<gossipsub::Behaviour>,
    topic: &gossipsub::IdentTopic,
    directory: &Path,
    sent: &mut std::collections::BTreeSet<String>,
    report: &mut SwarmReport,
) -> Result<()> {
    let mut count = 0;
    // Publish active niches, rather than repeatedly scanning every historical object.
    for path in nova_evolution::archive::active_paths(directory)? {
        if count >= 16 || sent.len() >= 65536 {
            break;
        }
        let Ok(elite) = nova_evolution::archive::read_elite(&path) else {
            continue;
        };
        if sent.contains(&elite.hash) {
            continue;
        }
        let hash = elite.hash.clone();
        let data = serde_json::to_vec(&Discovery::Elite { elite })?;
        if swarm.behaviour_mut().publish(topic.clone(), data).is_ok() {
            sent.insert(hash);
            report.published += 1;
            count += 1;
        }
    }
    let mut proofs: Vec<_> = std::fs::read_dir(directory.join("proof-outbox"))?
        .filter_map(|p| p.ok().map(|p| p.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .take(65536)
        .collect();
    proofs.sort();
    for path in proofs {
        if count >= 16 || sent.len() >= 65536 {
            break;
        }
        if std::fs::metadata(&path)?.len() > 1024 * 1024 {
            continue;
        }
        let data = std::fs::read(path)?;
        let Ok(proof) = serde_json::from_slice::<Discovery>(&data) else {
            continue;
        };
        if matches!(proof, Discovery::Elite { .. }) || proof.validate().is_err() {
            continue;
        }
        let hash = format!("{:x}", Sha256::digest(&data));
        if sent.contains(&hash) {
            continue;
        }
        if swarm.behaviour_mut().publish(topic.clone(), data).is_ok() {
            sent.insert(hash);
            report.published += 1;
            count += 1;
        }
    }
    Ok(())
}

fn receive(
    directory: &Path,
    data: &[u8],
    graph: &mut coherence::CoherenceGraph,
    report: &mut SwarmReport,
) -> Result<()> {
    if data.len() > 1024 * 1024 {
        report.rejected += 1;
        return Ok(());
    }
    let Ok(discovery) = serde_json::from_slice::<Discovery>(data) else {
        report.rejected += 1;
        return Ok(());
    };
    if discovery.validate().is_err() {
        report.rejected += 1;
        return Ok(());
    }
    if let Discovery::Section { section } = &discovery {
        match graph.merge(section.clone(), 1e-9) {
            Ok(conflicts) => report.overlap_conflicts += conflicts.len(),
            Err(_) => {
                report.rejected += 1;
                return Ok(());
            }
        }
    }
    let hash = format!("{:x}", Sha256::digest(data));
    let (path, value) = match discovery {
        Discovery::Elite { elite } => (
            directory.join("inbox").join(format!("{}.json", elite.hash)),
            serde_json::to_value(elite)?,
        ),
        envelope => (
            directory.join("proof-inbox").join(format!("{hash}.json")),
            serde_json::to_value(envelope)?,
        ),
    };
    if !path.exists() {
        nova_evolution::archive::atomic_json(&path, &value)?;
        report.accepted += 1;
    }
    Ok(())
}
