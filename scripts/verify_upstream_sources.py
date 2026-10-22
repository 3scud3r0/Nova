"""Verify pinned reference bytes without running upstream code."""
from pathlib import Path
import hashlib
import json
ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "third_party/upstream.lock.json").read_text())
count = 0
for repository in manifest["repositories"]:
    if not repository.get("source_root"):
        continue
    for entry in repository["files"]:
        path = ROOT / repository["source_root"] / entry["path"]
        if not path.resolve().is_relative_to(ROOT / "third_party/upstream"):
            raise SystemExit("source path escapes retained reference tree")
        if hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            raise SystemExit(f"source digest mismatch: {path.relative_to(ROOT)}")
        count += 1
print(f"{count} pinned source files verified")
