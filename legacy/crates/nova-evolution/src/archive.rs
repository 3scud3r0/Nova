use crate::{EvaluationConfig, Metrics};
use anyhow::{ensure, Result};
use nova_substrates::EnvironmentSpec;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Elite {
    pub schema: String,
    pub hash: String,
    pub engine_version: String,
    pub spec: EnvironmentSpec,
    pub evaluation: EvaluationConfig,
    pub metrics: Metrics,
}
impl Elite {
    pub fn new(
        spec: EnvironmentSpec,
        evaluation: EvaluationConfig,
        metrics: Metrics,
    ) -> Result<Self> {
        let mut e = Self {
            schema: "NOVA-ELITE-v1".into(),
            hash: String::new(),
            engine_version: env!("CARGO_PKG_VERSION").into(),
            spec,
            evaluation,
            metrics,
        };
        e.hash = e.digest()?;
        e.validate()?;
        Ok(e)
    }
    pub fn digest(&self) -> Result<String> {
        Ok(format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&(
                &self.schema,
                &self.engine_version,
                &self.spec,
                &self.evaluation,
                &self.metrics
            ))?)
        ))
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.schema == "NOVA-ELITE-v1"
                && !self.engine_version.is_empty()
                && self.engine_version.len() <= 64
                && self.hash.len() == 64
                && self.hash == self.digest()?,
            "elite hash/schema mismatch"
        );
        self.spec.validate()?;
        self.evaluation.validate()?;
        self.metrics.validate()
    }
}
pub fn bin(m: &Metrics, bins: usize) -> (usize, usize) {
    (
        ((m.entropy.clamp(0., 1.) * bins as f64) as usize).min(bins - 1),
        ((((m.autocorrelation + 1.) * 0.5).clamp(0., 1.) * bins as f64) as usize).min(bins - 1),
    )
}
#[derive(Serialize, Deserialize)]
struct Index {
    schema: String,
    bins: usize,
    elites: Vec<String>,
    evaluations: u64,
    #[serde(default)]
    rejected: u64,
    imported: BTreeSet<String>,
}
#[derive(Serialize)]
pub struct Summary {
    pub niches: usize,
    pub capacity: usize,
    pub evaluations: u64,
    pub rejected: u64,
    pub best_quality: f64,
}
pub struct Archive {
    pub root: PathBuf,
    pub bins: usize,
    pub cells: BTreeMap<(usize, usize), Elite>,
    evaluations: u64,
    rejected: u64,
    imported: BTreeSet<String>,
    lock: PathBuf,
}
impl Drop for Archive {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.lock);
    }
}
pub fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nonce = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_nanos();
    let tmp = path.with_extension(format!(
        "{}.{}.{}.tmp",
        std::process::id(),
        timestamp,
        nonce
    ));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&tmp)?;
    let result = (|| -> Result<()> {
        file.write_all(&serde_json::to_vec_pretty(value)?)?;
        file.sync_all()?;
        fs::rename(&tmp, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}
pub fn read_elite(path: &Path) -> Result<Elite> {
    ensure!(
        fs::metadata(path)?.len() <= 1024 * 1024,
        "elite file too large"
    );
    let e: Elite = serde_json::from_slice(&fs::read(path)?)?;
    e.validate()?;
    Ok(e)
}
impl Archive {
    pub fn open(root: &Path, bins: usize) -> Result<Self> {
        ensure!((2..=128).contains(&bins), "invalid bins");
        fs::create_dir_all(root.join("objects"))?;
        fs::create_dir_all(root.join("inbox"))?;
        let lock = root.join("search.lock");
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock)?
            .write_all(std::process::id().to_string().as_bytes())?;
        let mut a = Self {
            root: root.into(),
            bins,
            cells: BTreeMap::new(),
            evaluations: 0,
            rejected: 0,
            imported: BTreeSet::new(),
            lock,
        };
        let index = root.join("index.json");
        if index.exists() {
            ensure!(
                fs::metadata(&index)?.len() <= 8 * 1024 * 1024,
                "archive index too large"
            );
            let state: Index = serde_json::from_slice(&fs::read(&index)?)?;
            ensure!(
                state.schema == "NOVA-MAP-ELITES-v1"
                    && state.bins == bins
                    && state.elites.len() <= bins * bins,
                "archive index incompatible"
            );
            a.evaluations = state.evaluations;
            a.rejected = state.rejected;
            a.imported = state.imported;
            for hash in state.elites {
                ensure!(
                    hash.len() == 64 && hash.bytes().all(|x| x.is_ascii_hexdigit()),
                    "invalid archive hash"
                );
                let e = read_elite(&root.join("objects").join(format!("{hash}.json")))?;
                ensure!(e.hash == hash, "object path/hash mismatch");
                a.cells.insert(bin(&e.metrics, bins), e);
            }
        }
        Ok(a)
    }
    pub fn insert(&mut self, e: Elite) -> Result<bool> {
        e.validate()?;
        self.evaluations = self.evaluations.saturating_add(1);
        let slot = bin(&e.metrics, self.bins);
        if e.metrics.quality <= 0.
            || self
                .cells
                .get(&slot)
                .is_some_and(|old| old.metrics.quality >= e.metrics.quality)
        {
            return Ok(false);
        }
        let path = self.root.join("objects").join(format!("{}.json", e.hash));
        if !path.exists() {
            atomic_json(&path, &e)?;
        }
        self.cells.insert(slot, e);
        Ok(true)
    }
    pub fn pending_specs(&mut self, limit: usize) -> Result<Vec<EnvironmentSpec>> {
        let mut paths: Vec<_> = fs::read_dir(self.root.join("inbox"))?
            .filter_map(|p| p.ok().map(|x| x.path()))
            .filter(|p| p.extension().is_some_and(|x| x == "json"))
            .collect();
        paths.sort();
        let mut result = vec![];
        for path in paths {
            if result.len() >= limit || self.imported.len() >= 65536 {
                break;
            }
            let Ok(e) = read_elite(&path) else { continue };
            if self.imported.insert(e.hash.clone()) {
                result.push(e.spec)
            }
        }
        Ok(result)
    }
    pub fn record_rejection(&mut self, seed: u64, reason: &str) -> Result<()> {
        self.rejected = self.rejected.saturating_add(1);
        let mut log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.root.join("rejections.jsonl"))?;
        let bounded: String = reason.chars().take(1024).collect();
        writeln!(log, "{}", serde_json::json!({"seed":seed,"reason":bounded}))?;
        Ok(())
    }
    pub fn flush(&self) -> Result<()> {
        atomic_json(
            &self.root.join("index.json"),
            &Index {
                schema: "NOVA-MAP-ELITES-v1".into(),
                bins: self.bins,
                elites: self.cells.values().map(|e| e.hash.clone()).collect(),
                evaluations: self.evaluations,
                rejected: self.rejected,
                imported: self.imported.clone(),
            },
        )
    }
    pub fn summary(&self) -> Summary {
        Summary {
            niches: self.cells.len(),
            capacity: self.bins * self.bins,
            evaluations: self.evaluations,
            rejected: self.rejected,
            best_quality: self
                .cells
                .values()
                .map(|e| e.metrics.quality)
                .fold(0., f64::max),
        }
    }
}

/// Read the atomically published active niche index without taking the writer lock.
pub fn active_paths(root: &Path) -> Result<Vec<PathBuf>> {
    let path = root.join("index.json");
    if !path.exists() {
        return Ok(vec![]);
    }
    ensure!(
        fs::metadata(&path)?.len() <= 8 * 1024 * 1024,
        "archive index too large"
    );
    let index: Index = serde_json::from_slice(&fs::read(path)?)?;
    ensure!(
        index.schema == "NOVA-MAP-ELITES-v1"
            && (2..=128).contains(&index.bins)
            && index.elites.len() <= index.bins * index.bins,
        "invalid active index"
    );
    let mut paths = vec![];
    for hash in index.elites {
        ensure!(
            hash.len() == 64 && hash.bytes().all(|x| x.is_ascii_hexdigit()),
            "invalid object hash"
        );
        paths.push(root.join("objects").join(format!("{hash}.json")));
    }
    paths.sort();
    Ok(paths)
}
