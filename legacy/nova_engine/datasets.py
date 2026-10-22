"""Industry-format readers and catalog builders, activated only when requested."""
from pathlib import Path
import json


def open_fields(directory):
    import zarr
    return zarr.open_group(str(Path(directory) / "world.zarr"), mode="r")["fields"]


def catalog(directory):
    import duckdb
    root = Path(directory).resolve()
    db = duckdb.connect(str(root / "catalog.duckdb"))
    # Relation API binds filenames without interpolating SQL syntax.
    db.read_parquet(str(root / "symbolic.parquet")).create_view("symbolic", replace=True)
    if (root / "lineages.jsonl").stat().st_size:
        db.read_json(str(root / "lineages.jsonl")).create_view("lineages", replace=True)
    return db


def export_huggingface(directory, *, output=None):
    from datasets import Dataset, DatasetDict, load_dataset
    import pyarrow.ipc as ipc
    root = Path(directory)
    manifest = json.loads((root / "manifest.json").read_text())
    if manifest["status"] != "complete" or manifest["frames"] == 0:
        raise ValueError("a completed nonempty lake is required")
    tables = {}
    for name, filename in [("trajectories", "trajectories.arrow"), ("genomes", "genomes.arrow")]:
        with (root / filename).open("rb") as handle:
            tables[name] = Dataset(ipc.open_stream(handle).read_all())
    tables["symbolic"] = load_dataset("parquet", data_files=str(root / "symbolic.parquet"), split="train")
    result = DatasetDict(tables)
    result.save_to_disk(str(output or root / "huggingface"))
    return result


def lookup_lineage(directory, lineage_hash):
    """Byte-offset index lookup; hashes are data, never filesystem paths."""
    root = Path(directory)
    with (root / "lineages.index.jsonl").open() as index, (root / "lineages.jsonl").open("rb") as data:
        for raw in index:
            entry = json.loads(raw)
            if entry["lineage_hash"] == lineage_hash:
                data.seek(entry["byte_offset"])
                record = json.loads(data.read(entry["byte_length"]))
                if record["lineage_hash"] != lineage_hash:
                    raise ValueError("lineage index mismatch")
                return record
    raise KeyError(lineage_hash)
