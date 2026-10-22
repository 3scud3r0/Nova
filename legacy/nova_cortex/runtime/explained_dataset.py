"""Streaming explained offline-RL transitions in Arrow IPC and Parquet.

Observations are sensory embeddings; raw simulator fields can be recorded by the
native publisher. Text is evidence-scoped telemetry, not a reasoning transcript.
"""

from pathlib import Path
import json
import numpy as np


class ExplainedDataset:
    def __init__(self, directory, config, *, metadata=None):
        import pyarrow as pa
        import pyarrow.ipc as ipc
        import pyarrow.parquet as parquet

        self.root = Path(directory)
        if self.root.exists() and any(self.root.iterdir()):
            raise ValueError("explained output must be empty")
        self.root.mkdir(parents=True, exist_ok=True)
        self.config, self.rows = config, 0
        self.schema = pa.schema(
            [
                pa.field("episode_id", pa.int64()),
                pa.field("tick", pa.uint64()),
                pa.field("next_tick", pa.uint64()),
                pa.field("model_step", pa.uint64()),
                pa.field("observation", pa.list_(pa.float32(), config.embedding)),
                pa.field("next_observation", pa.list_(pa.float32(), config.embedding)),
                pa.field("action", pa.list_(pa.float32(), config.action_dim)),
                pa.field("reward", pa.float32()),
                pa.field("terminal", pa.bool_()),
                pa.field("truncated", pa.bool_()),
                pa.field("latent", pa.list_(pa.float32(), config.latent)),
                pa.field("active_feature_ids", pa.list_(pa.int32())),
                pa.field("active_feature_values", pa.list_(pa.float32())),
                pa.field("explanation", pa.string()),
                pa.field("evidence", pa.string()),
                pa.field("observables", pa.string()),
                pa.field("next_observables", pa.string()),
            ]
        )
        self.arrow_file = pa.OSFile(str(self.root / "explained.arrow"), "wb")
        self.arrow = ipc.new_stream(self.arrow_file, self.schema)
        self.parquet = parquet.ParquetWriter(
            str(self.root / "explained.parquet"), self.schema, compression="zstd"
        )
        self.rows_pending = []
        self.metadata = dict(
            schema="NOVA-EXPLAINED-v1",
            observation_space="sensory embedding",
            action_space="bounded normalized brush controls",
            config=config.to_dict(),
            explanation_scope="audited labels where available; no free-form claimed thoughts",
            metadata=metadata or {},
            status="recording",
        )
        self._manifest()

    def _manifest(self):
        path = self.root / "manifest.json"
        temporary = path.with_suffix("tmp")
        temporary.write_text(
            json.dumps({**self.metadata, "rows": self.rows}, indent=2, allow_nan=False)
        )
        temporary.replace(path)

    def record(self, record):
        expected = {
            "observation": self.config.embedding,
            "next_observation": self.config.embedding,
            "action": self.config.action_dim,
            "latent": self.config.latent,
        }
        for name, width in expected.items():
            value = np.asarray(record[name], dtype=np.float32)
            if value.shape != (width,) or not np.isfinite(value).all():
                raise ValueError(f"invalid transition vector {name}")
            record[name] = value.tolist()
        if not np.isfinite(record["reward"]) or record["next_tick"] <= record["tick"]:
            raise ValueError("invalid transition reward/ticks")
        if len(record["active_feature_ids"]) != len(record["active_feature_values"]):
            raise ValueError("sparse activation index/value mismatch")
        for name in ("evidence", "observables", "next_observables"):
            record[name] = json.dumps(record[name], allow_nan=False, sort_keys=True)
        self.rows_pending.append(record)
        if len(self.rows_pending) >= 32:
            self.flush()

    def flush(self):
        if not self.rows_pending:
            return
        import pyarrow as pa

        batch = pa.RecordBatch.from_pylist(self.rows_pending, schema=self.schema)
        self.arrow.write_batch(batch)
        self.parquet.write_table(pa.Table.from_batches([batch]))
        self.rows += len(self.rows_pending)
        self.rows_pending.clear()
        self._manifest()

    def close(self, *, complete=True):
        self.flush()
        self.arrow.close()
        self.arrow_file.close()
        self.parquet.close()
        self.metadata["status"] = "complete" if complete else "interrupted"
        self._manifest()


def arrow_transitions(path):
    import pyarrow as pa
    import pyarrow.ipc as ipc

    with pa.memory_map(str(path), "r") as source:
        yield from ipc.open_stream(source)


def export_d4rl(directory, output, *, max_rows=1_000_000):
    """D4RL-shaped arrays with explicit timeouts; not an environment registration."""
    root = Path(directory)
    manifest = json.loads((root / "manifest.json").read_text())
    if (
        manifest.get("status") != "complete"
        or not 0 < manifest.get("rows", 0) <= max_rows
    ):
        raise ValueError("a complete bounded nonempty explained dataset is required")
    arrays = {
        name: []
        for name in (
            "observations",
            "next_observations",
            "actions",
            "rewards",
            "terminals",
            "timeouts",
        )
    }
    names = dict(
        observations="observation",
        next_observations="next_observation",
        actions="action",
        rewards="reward",
        terminals="terminal",
        timeouts="truncated",
    )
    for batch in arrow_transitions(root / "explained.arrow"):
        for out, column in names.items():
            arrays[out].extend(
                batch.column(batch.schema.get_field_index(column)).to_pylist()
            )
    with Path(output).open("xb") as handle:
        np.savez_compressed(handle, **{k: np.asarray(v) for k, v in arrays.items()})
