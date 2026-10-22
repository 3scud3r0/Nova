//! Incremental Arrow IPC, Parquet and Zarr v3; bounded per-frame working memory.
use anyhow::{ensure, Result};
use arrow::{
    array::{ArrayRef, Float32Array, Float64Array, StringArray, UInt32Array, UInt64Array},
    datatypes::{DataType, Field, Schema},
    ipc::writer::StreamWriter,
    record_batch::RecordBatch,
};
use nova_core::Particles;
use nova_physics::Universe;
use nova_science::{observe, relevance, sparse_fit, Observables};
use parquet::{
    arrow::ArrowWriter,
    basic::{Compression, ZstdLevel},
    file::properties::WriterProperties,
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
fn schema(fields: &[(&str, DataType)]) -> Arc<Schema> {
    Arc::new(Schema::new(
        fields
            .iter()
            .map(|(n, t)| Field::new(*n, t.clone(), false))
            .collect::<Vec<_>>(),
    ))
}
fn write_json(path: &Path, value: &Value) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
    fs::rename(tmp, path)?;
    Ok(())
}
pub struct Lake {
    root: PathBuf,
    id: String,
    grid: usize,
    extent: f32,
    frames: usize,
    seen: HashSet<String>,
    trajectory: StreamWriter<BufWriter<File>>,
    genomes: StreamWriter<BufWriter<File>>,
    symbolic: ArrowWriter<File>,
    ts: Arc<Schema>,
    gs: Arc<Schema>,
    ss: Arc<Schema>,
    lineage: BufWriter<File>,
    index: BufWriter<File>,
    offset: u64,
    previous: HashMap<u64, ([f32; 4], [f32; 4])>,
    previous_observation: Option<Observables>,
    previous_tick: Option<u64>,
}
impl Lake {
    pub fn new(root: impl AsRef<Path>, u: &Universe, grid: usize, extent: f32) -> Result<Self> {
        ensure!(
            (4..=128).contains(&grid) && extent.is_finite() && extent > 0.,
            "invalid field grid or extent"
        );
        let root = root.as_ref().to_owned();
        if root.exists() {
            ensure!(
                fs::read_dir(&root)?.next().is_none(),
                "output directory must be empty; refusing to overwrite a lake"
            );
        } else {
            fs::create_dir_all(&root)?;
        }
        let id = format!(
            "nova-{:016x}-{}",
            u.config.seed,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos()
        );
        let ts = schema(&[
            ("tick", DataType::UInt64),
            ("particle_id", DataType::UInt64),
            ("x", DataType::Float32),
            ("y", DataType::Float32),
            ("z", DataType::Float32),
            ("vx", DataType::Float32),
            ("vy", DataType::Float32),
            ("vz", DataType::Float32),
            ("mass", DataType::Float32),
            ("species", DataType::UInt32),
        ]);
        let gs = schema(&[
            ("lineage_hash", DataType::Utf8),
            ("generation_depth", DataType::UInt32),
            ("bytecode_payload", DataType::Utf8),
            ("phenotype_metrics", DataType::Utf8),
            ("parents", DataType::Utf8),
            ("born_tick", DataType::UInt64),
        ]);
        let ss = schema(&[
            ("dataset_id", DataType::Utf8),
            ("tick", DataType::UInt64),
            ("trajectory_sample", DataType::Utf8),
            ("discovered_equation", DataType::Utf8),
            ("noether_invariant_drift", DataType::Float64),
            ("lean_verification_receipt", DataType::Utf8),
            ("observables", DataType::Utf8),
            ("relevance", DataType::Utf8),
        ]);
        let trajectory = StreamWriter::try_new(
            BufWriter::new(File::create(root.join("trajectories.arrow"))?),
            &ts,
        )?;
        let genomes = StreamWriter::try_new(
            BufWriter::new(File::create(root.join("genomes.arrow"))?),
            &gs,
        )?;
        let props = WriterProperties::builder()
            .set_compression(Compression::ZSTD(ZstdLevel::try_new(3)?))
            .set_max_row_group_size(128)
            .build();
        let symbolic = ArrowWriter::try_new(
            File::create(root.join("symbolic.parquet"))?,
            ss.clone(),
            Some(props),
        )?;
        fs::create_dir_all(root.join("world.zarr/fields"))?;
        write_json(
            &root.join("world.zarr/zarr.json"),
            &json!({"zarr_format":3,"node_type":"group","attributes":{"dataset_id":id}}),
        )?;
        fs::write(
            root.join("PairMomentum.lean"),
            nova_science::lean_template(),
        )?;
        fs::write(root.join("catalog.sql"),"CREATE OR REPLACE VIEW symbolic AS SELECT * FROM read_parquet('symbolic.parquet');\nCREATE OR REPLACE VIEW lineages AS SELECT * FROM read_json_auto('lineages.jsonl');\n")?;
        fs::write(
            root.join("load_dataset.py"),
            r#"from pathlib import Path
from datasets import Dataset, DatasetDict, load_dataset
import pyarrow.ipc as ipc
root = Path(__file__).resolve().parent
# Arrow streams retain their schema; Hugging Face load_from_disk needs save_to_disk first.
with (root / 'trajectories.arrow').open('rb') as f:
    trajectories = Dataset(ipc.open_stream(f).read_all())
with (root / 'genomes.arrow').open('rb') as f:
    genomes = Dataset(ipc.open_stream(f).read_all())
result = DatasetDict(trajectories=trajectories, genomes=genomes,
    symbolic=load_dataset('parquet', data_files=str(root / 'symbolic.parquet'), split='train'))
result.save_to_disk(str(root / 'huggingface'))
"#,
        )?;
        write_json(
            &root.join("dataset_dict.json"),
            &json!({"splits":["trajectories","genomes","symbolic"],"format":"NOVA export manifest; run load_dataset.py before datasets.load_from_disk"}),
        )?;
        write_json(
            &root.join("manifest.json"),
            &json!({"schema":"NOVA-LAKE-v1","dataset_id":id,"config":u.config,"affinities":u.matrix,"field_extent":extent,"field_grid":grid,"status":"recording","conservative":false,"proof_status":"pending","temperature_units":"specific kinetic variance, not kelvin","stress_definition":"coarse kinetic stress from within-voxel velocity fluctuations","field_domain":"fixed [-extent,extent)^3; out-of-domain count recorded per frame"}),
        )?;
        let lineage = BufWriter::new(File::create(root.join("lineages.jsonl"))?);
        let index = BufWriter::new(File::create(root.join("lineages.index.jsonl"))?);
        let lake = Self {
            root,
            id,
            grid,
            extent,
            frames: 0,
            seen: HashSet::new(),
            trajectory,
            genomes,
            symbolic,
            ts,
            gs,
            ss,
            lineage,
            index,
            offset: 0,
            previous: HashMap::new(),
            previous_observation: None,
            previous_tick: None,
        };
        lake.zarr_metadata()?;
        Ok(lake)
    }
    pub fn record(&mut self, u: &Universe, record_all: bool) -> Result<bool> {
        u.particles.validate()?;
        ensure!(
            self.previous_tick.is_none_or(|t| u.tick > t),
            "recorded ticks must increase"
        );
        let p = &u.particles;
        let relevance = relevance(p);
        // Observe every new genotype even when the frame relevance gate rejects its trajectory.
        self.record_lineages(u)?;
        if !record_all && !relevance.accepted {
            return Ok(false);
        }
        let n = p.len();
        let mut columns: Vec<ArrayRef> = vec![
            Arc::new(UInt64Array::from(vec![u.tick; n])),
            Arc::new(UInt64Array::from(p.ids.clone())),
        ];
        for k in 0..3 {
            columns.push(Arc::new(Float32Array::from_iter_values(
                p.positions.iter().map(|x| x.0[k]),
            )));
        }
        for k in 0..3 {
            columns.push(Arc::new(Float32Array::from_iter_values(
                p.velocities.iter().map(|x| x.0[k]),
            )));
        }
        columns.push(Arc::new(Float32Array::from_iter_values(
            p.velocities.iter().map(|x| x.0[3]),
        )));
        columns.push(Arc::new(UInt32Array::from_iter_values(
            p.phenotypes.iter().map(|x| x[0]),
        )));
        self.trajectory
            .write(&RecordBatch::try_new(self.ts.clone(), columns)?)?;
        let elapsed = self
            .previous_tick
            .map(|t| (u.tick - t) as f64 * u.config.dt as f64)
            .unwrap_or(0.);
        let mut rows = Vec::new();
        let mut targets = Vec::new();
        let mut samples = Vec::new();
        let mut order: Vec<_> = (0..n).collect();
        order.sort_unstable_by_key(|&i| p.ids[i]);
        order.truncate(256);
        for &i in &order {
            let x = p.positions[i].0;
            let v = p.velocities[i].0;
            samples.push(json!({"id":p.ids[i],"position":x,"velocity_mass":v}));
            if elapsed > 0. {
                if let Some((oldx, oldv)) = self.previous.get(&p.ids[i]) {
                    rows.push([
                        1.,
                        oldx[0] as f64,
                        oldx[1] as f64,
                        oldx[2] as f64,
                        oldv[0] as f64,
                        oldv[1] as f64,
                        oldv[2] as f64,
                    ]);
                    targets.push((v[0] - oldv[0]) as f64 / elapsed);
                }
            }
        }
        let candidate = if rows.len() >= 8 {
            serde_json::to_value(sparse_fit(&rows, &targets, 1e-4)?)?
        } else {
            json!({"status":"insufficient_samples"})
        };
        let observation = observe(p);
        let drift = if elapsed > 0. {
            self.previous_observation
                .as_ref()
                .map(|o| (observation.kinetic - o.kinetic) / elapsed)
                .unwrap_or(0.)
        } else {
            0.
        };
        let receipt = json!({"status":"pending","file":"PairMomentum.lean","claim":"pair impulse algebra only; not a proof of the discovered regression","physical_truth_proved":false});
        let strings = [
            self.id.clone(),
            serde_json::to_string(&samples)?,
            candidate.to_string(),
            receipt.to_string(),
            serde_json::to_string(&observation)?,
            serde_json::to_string(&relevance)?,
        ];
        let s = |i: usize| -> ArrayRef { Arc::new(StringArray::from(vec![strings[i].as_str()])) };
        self.symbolic.write(&RecordBatch::try_new(
            self.ss.clone(),
            vec![
                s(0),
                Arc::new(UInt64Array::from(vec![u.tick])),
                s(1),
                s(2),
                Arc::new(Float64Array::from(vec![drift])),
                s(3),
                s(4),
                s(5),
            ],
        )?)?;
        let (field, outside) = voxelize(p, self.grid, self.extent);
        ensure!(
            field.iter().all(|x| x.is_finite()),
            "nonfinite coarse field"
        );
        let raw: Vec<u8> = field.iter().flat_map(|x| x.to_le_bytes()).collect();
        let chunk = self
            .root
            .join(format!("world.zarr/fields/c/{}/0/0/0", self.frames));
        fs::create_dir_all(&chunk)?;
        let compressed = zstd::stream::encode_all(raw.as_slice(), 3)?;
        fs::write(chunk.join("0.tmp"), compressed)?;
        fs::rename(chunk.join("0.tmp"), chunk.join("0"))?;
        let mut frames = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.root.join("frames.jsonl"))?;
        writeln!(
            frames,
            "{}",
            json!({"frame":self.frames,"tick":u.tick,"time":u.tick as f64*u.config.dt as f64,"outside_field_domain":outside,"kinetic_drift":drift,"drift_available":elapsed>0.})
        )?;
        self.frames += 1;
        self.zarr_metadata()?;
        self.previous = order
            .iter()
            .map(|&i| (p.ids[i], (p.positions[i].0, p.velocities[i].0)))
            .collect();
        self.previous_tick = Some(u.tick);
        self.previous_observation = Some(observation);
        Ok(true)
    }
    fn record_lineages(&mut self, u: &Universe) -> Result<()> {
        let p = &u.particles;
        let mut hashes = Vec::new();
        let mut generation = Vec::new();
        let mut tapes = Vec::new();
        let mut metrics = Vec::new();
        let mut parents = Vec::new();
        let mut ticks = Vec::new();
        for i in 0..p.len() {
            let l = &p.lineages[i];
            if !self.seen.insert(l.hash.clone()) {
                continue;
            }
            let tape = serde_json::to_string(&p.genomes[i])?;
            let metrics_json = json!({"particle_id":p.ids[i],"species":p.phenotypes[i][0],"metabolic_energy":p.phenotypes[i][3],"replication_rate":null,"energy_efficiency":null,"behavioral_complexity":null});
            let row = json!({"lineage_hash":l.hash,"generation_depth":l.generation,"bytecode_payload":p.genomes[i],"phenotype_metrics":metrics_json,"parents":l.parents,"born_tick":l.born_tick});
            let raw = serde_json::to_vec(&row)?;
            writeln!(
                self.index,
                "{}",
                json!({"lineage_hash":l.hash,"byte_offset":self.offset,"byte_length":raw.len()})
            )?;
            self.lineage.write_all(&raw)?;
            self.lineage.write_all(b"\n")?;
            self.offset += raw.len() as u64 + 1;
            hashes.push(l.hash.clone());
            generation.push(l.generation);
            tapes.push(tape);
            metrics.push(metrics_json.to_string());
            parents.push(serde_json::to_string(&l.parents)?);
            ticks.push(l.born_tick);
        }
        if !hashes.is_empty() {
            self.genomes.write(&RecordBatch::try_new(
                self.gs.clone(),
                vec![
                    Arc::new(StringArray::from(hashes)),
                    Arc::new(UInt32Array::from(generation)),
                    Arc::new(StringArray::from(tapes)),
                    Arc::new(StringArray::from(metrics)),
                    Arc::new(StringArray::from(parents)),
                    Arc::new(UInt64Array::from(ticks)),
                ],
            )?)?;
        }
        self.lineage.flush()?;
        self.index.flush()?;
        Ok(())
    }
    fn zarr_metadata(&self) -> Result<()> {
        write_json(
            &self.root.join("world.zarr/fields/zarr.json"),
            &json!({"zarr_format":3,"node_type":"array","shape":[self.frames,12,self.grid,self.grid,self.grid],"data_type":"float32","chunk_grid":{"name":"regular","configuration":{"chunk_shape":[1,12,self.grid,self.grid,self.grid]}},"chunk_key_encoding":{"name":"default","configuration":{"separator":"/"}},"fill_value":0.,"codecs":[{"name":"bytes","configuration":{"endian":"little"}},{"name":"zstd","configuration":{"level":3,"checksum":false}}],"dimension_names":["time","channel","x","y","z"],"attributes":{"channels":["density","vx","vy","vz","divergence","kinetic_stress_xx","kinetic_stress_yy","kinetic_stress_zz","kinetic_stress_xy","kinetic_stress_xz","kinetic_stress_yz","kinetic_temperature"],"origin":[-self.extent,-self.extent,-self.extent],"spacing":2.*self.extent/self.grid as f32}}),
        )
    }
    pub fn finish(mut self) -> Result<()> {
        self.trajectory.finish()?;
        self.trajectory.into_inner()?.flush()?;
        self.genomes.finish()?;
        self.genomes.into_inner()?.flush()?;
        self.symbolic.close()?;
        self.lineage.flush()?;
        self.index.flush()?;
        let path = self.root.join("manifest.json");
        let mut manifest: Value = serde_json::from_slice(&fs::read(&path)?)?;
        manifest["status"] = json!("complete");
        manifest["frames"] = json!(self.frames);
        write_json(&path, &manifest)
    }
}
fn voxelize(p: &Particles, g: usize, extent: f32) -> (Vec<f32>, usize) {
    let n = g * g * g;
    let dx = 2. * extent / g as f32;
    let volume = dx.powi(3);
    let mut field = vec![0.; 12 * n];
    let mut outside = 0;
    let mut members = Vec::with_capacity(p.len());
    for i in 0..p.len() {
        let x = p.positions[i].0;
        let q = [
            ((x[0] + extent) / dx).floor(),
            ((x[1] + extent) / dx).floor(),
            ((x[2] + extent) / dx).floor(),
        ];
        if q.iter().any(|&x| x < 0. || x >= g as f32) {
            outside += 1;
            members.push(None);
            continue;
        }
        let idx = (q[0] as usize * g + q[1] as usize) * g + q[2] as usize;
        members.push(Some(idx));
        let v = p.velocities[i].0;
        field[idx] += v[3] / volume;
        for k in 0..3 {
            field[(k + 1) * n + idx] += v[k] * v[3] / volume;
        }
    }
    for idx in 0..n {
        if field[idx] > 0. {
            for k in 1..=3 {
                field[k * n + idx] /= field[idx];
            }
        }
    }
    for (i, idx) in members.into_iter().enumerate() {
        if let Some(idx) = idx {
            let v = p.velocities[i].0;
            let d = [
                v[0] - field[n + idx],
                v[1] - field[2 * n + idx],
                v[2] - field[3 * n + idx],
            ];
            for (k, (a, b)) in [(0, 0), (1, 1), (2, 2), (0, 1), (0, 2), (1, 2)]
                .into_iter()
                .enumerate()
            {
                field[(5 + k) * n + idx] += v[3] * d[a] * d[b] / volume;
            }
        }
    }
    for x in 0..g {
        for y in 0..g {
            for z in 0..g {
                let idx = (x * g + y) * g + z;
                let coord = [x, y, z];
                let mut div = 0.;
                for k in 0..3 {
                    let mut lo = coord;
                    let mut hi = coord;
                    lo[k] = lo[k].saturating_sub(1);
                    hi[k] = (hi[k] + 1).min(g - 1);
                    let a = (lo[0] * g + lo[1]) * g + lo[2];
                    let b = (hi[0] * g + hi[1]) * g + hi[2];
                    div += (field[(k + 1) * n + b] - field[(k + 1) * n + a])
                        / ((hi[k] - lo[k]) as f32 * dx);
                }
                field[4 * n + idx] = div;
                if field[idx] > 0. {
                    field[11 * n + idx] =
                        (field[5 * n + idx] + field[6 * n + idx] + field[7 * n + idx])
                            / (3. * field[idx]);
                }
            }
        }
    }
    (field, outside)
}
