//! Uniform substrate tensor writer: Arrow IPC, Zarr v3 and action provenance.
use anyhow::{ensure, Result};
use arrow::{
    array::{ArrayRef, Float32Array, UInt64Array},
    datatypes::{DataType, Field, Schema},
    ipc::writer::StreamWriter,
    record_batch::RecordBatch,
};
use nova_substrates::{Action, EnvironmentSpec, TensorView};
use serde_json::json;
use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
pub struct TensorLake {
    root: PathBuf,
    shape: [usize; 4],
    frames: usize,
    last_tick: Option<u64>,
    writer: Option<StreamWriter<BufWriter<File>>>,
    schema: Arc<Schema>,
    actions: BufWriter<File>,
}
impl TensorLake {
    pub fn new(root: &Path, spec: &EnvironmentSpec, view: TensorView<'_>) -> Result<Self> {
        ensure!(
            view.shape[0] == 4
                && view.shape.iter().all(|&d| d > 0)
                && view.shape.iter().try_fold(1usize, |a, &b| a.checked_mul(b))
                    == Some(view.values.len())
                && view.values.len() <= 8_388_608
                && view.values.iter().all(|x| x.is_finite()),
            "invalid tensor layout or memory budget"
        );
        ensure!(
            !root.exists() || fs::read_dir(root)?.next().is_none(),
            "tensor output must be empty"
        );
        fs::create_dir_all(root.join("world.zarr/fields"))?;
        let schema = Arc::new(Schema::new(vec![
            Field::new("tick", DataType::UInt64, false),
            Field::new("channel", DataType::UInt64, false),
            Field::new("voxel", DataType::UInt64, false),
            Field::new("value", DataType::Float32, false),
        ]));
        let writer = StreamWriter::try_new(
            BufWriter::new(File::create(root.join("tensors.arrow"))?),
            &schema,
        )?;
        fs::write(
            root.join("environment.json"),
            serde_json::to_vec_pretty(spec)?,
        )?;
        fs::write(
            root.join("manifest.json"),
            serde_json::to_vec_pretty(
                &json!({"schema":"NOVA-TENSORS-v1","status":"recording","layout":"time,channel,z,y,x","channels":"substrate-specific density,vx,vy,auxiliary; auxiliary is energy, growth, pressure or species B","world_model_claim":"observations of declared simulator only"}),
            )?,
        )?;
        fs::write(
            root.join("world.zarr/zarr.json"),
            br#"{"zarr_format":3,"node_type":"group","attributes":{}}"#,
        )?;
        let a = Self {
            root: root.into(),
            shape: view.shape,
            frames: 0,
            last_tick: None,
            writer: Some(writer),
            schema,
            actions: BufWriter::new(File::create(root.join("actions.jsonl"))?),
        };
        a.metadata()?;
        Ok(a)
    }
    fn metadata(&self) -> Result<()> {
        let [c, z, y, x] = self.shape;
        let value = json!({"zarr_format":3,"node_type":"array","shape":[self.frames,c,z,y,x],"data_type":"float32","chunk_grid":{"name":"regular","configuration":{"chunk_shape":[1,c,z,y,x]}},"chunk_key_encoding":{"name":"default","configuration":{"separator":"/"}},"fill_value":0.,"codecs":[{"name":"bytes","configuration":{"endian":"little"}},{"name":"zstd","configuration":{"level":3,"checksum":false}}],"dimension_names":["time","channel","z","y","x"],"attributes":{}});
        let path = self.root.join("world.zarr/fields/zarr.json");
        let tmp = path.with_extension("tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(&value)?)?;
        fs::rename(tmp, path)?;
        Ok(())
    }
    /// The action is applied after this observation and before the following frame.
    pub fn record(&mut self, view: TensorView<'_>, action: Option<&Action>) -> Result<()> {
        ensure!(
            view.shape == self.shape
                && view.shape.iter().product::<usize>() == view.values.len()
                && view.values.iter().all(|x| x.is_finite())
                && self.last_tick.is_none_or(|t| view.tick > t),
            "tensor shape, values or tick mismatch"
        );
        if let Some(a) = action {
            a.validate()?;
        }
        let n = view.spatial_len();
        let columns: Vec<ArrayRef> = vec![
            Arc::new(UInt64Array::from(vec![view.tick; view.values.len()])),
            Arc::new(UInt64Array::from_iter_values(
                (0..view.values.len()).map(|i| (i / n) as u64),
            )),
            Arc::new(UInt64Array::from_iter_values(
                (0..view.values.len()).map(|i| (i % n) as u64),
            )),
            Arc::new(Float32Array::from(view.values.to_vec())),
        ];
        self.writer
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("closed tensor writer"))?
            .write(&RecordBatch::try_new(self.schema.clone(), columns)?)?;
        let bytes: Vec<_> = view.values.iter().flat_map(|x| x.to_le_bytes()).collect();
        let compressed = zstd::encode_all(bytes.as_slice(), 3)?;
        let path = self
            .root
            .join(format!("world.zarr/fields/c/{}/0/0/0", self.frames));
        fs::create_dir_all(&path)?;
        fs::write(path.join("0"), compressed)?;
        writeln!(
            self.actions,
            "{}",
            json!({"frame":self.frames,"tick":view.tick,"action":action})
        )?;
        self.actions.flush()?;
        self.frames += 1;
        self.last_tick = Some(view.tick);
        self.metadata()
    }
    pub fn finish(mut self) -> Result<()> {
        if let Some(mut w) = self.writer.take() {
            w.finish()?;
        }
        self.actions.flush()?;
        fs::write(
            self.root.join("manifest.json"),
            serde_json::to_vec_pretty(
                &json!({"schema":"NOVA-TENSORS-v1","status":"complete","frames":self.frames,"shape":self.shape,"layout":"time,channel,z,y,x","channels":"density,vx,vy,substrate-dependent auxiliary"}),
            )?,
        )?;
        Ok(())
    }
}
