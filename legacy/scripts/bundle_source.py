"""Create a deterministic, human-readable source bundle with per-file SHA-256."""

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIRECTORIES = (
    "nova",
    "nova_engine",
    "nova_cortex",
    "crates",
    "src",
    "include",
    "examples",
    "docs/native",
    "nova-core/src",
    "experiments",
    "tests",
    "scripts",
    "configs",
    ".github",
)
FILES = (
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "third_party/upstream.lock.json",
    "third_party/README.md",
    "crates/nova-python/LICENSE",
    "crates/nova-python/THIRD_PARTY_NOTICES.md",
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
    "pyproject.toml",
    "requirements-cpu.txt",
    "nova-core/Cargo.toml",
    "nova-core/build.rs",
    "nova-core/pyproject.toml",
    "nova-core/Cargo.lock",
    ".gitignore",
    ".gitattributes",
    "README.md",
    "DEVIATIONS.md",
    "docs/identity.md",
    "docs/adaptive-energy.md",
    "docs/biocosm.md",
    "docs/planetary.md",
    "docs/chromatic.md",
    "reports/chromatic/STATUS.md",
    "reports/chromatic/status.json",
    "reports/planetary/STATUS.md",
    "reports/planetary/status.json",
    "reports/biocosm/STATUS.md",
    "reports/biocosm/status.json",
    "reports/adaptive/STATUS.md",
    "reports/adaptive/status.json",
    "reports/STATUS.md",
)
EXTENSIONS = {
    ".h",
    ".c",
    ".md",
    ".py",
    ".rs",
    ".sh",
    ".yaml",
    ".yml",
    ".toml",
    ".json",
    ".html",
    ".js",
    ".wgsl",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rust-only", action="store_true", help="Bundle native Rust/WGSL sources, manifests, C header and notices")
    args = parser.parse_args()
    paths = {ROOT / path for path in FILES}
    for directory in DIRECTORIES:
        paths.update(
            p
            for p in (ROOT / directory).rglob("*")
            if p.is_file() and p.suffix in EXTENSIONS and "__pycache__" not in p.parts
        )
    # Preserve all selected source types (TS/GDScript/GLSL/C++ included), with raw-byte hashes.
    upstream = json.loads((ROOT / "third_party/upstream.lock.json").read_text())
    for repository in upstream["repositories"]:
        if repository.get("source_root"):
            paths.update(ROOT / repository["source_root"] / item["path"] for item in repository["files"])
    if args.rust_only:
        paths = {
            p for p in paths
            if not p.relative_to(ROOT).as_posix().startswith(("third_party/upstream/", "nova-core/"))
            and (p.suffix in {".rs", ".wgsl", ".h"}
                 or p.name in {"Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "LICENSE", "THIRD_PARTY_NOTICES.md"}
                 or p == ROOT / "third_party/upstream.lock.json")
        }
    ordered = sorted(paths, key=lambda p: p.relative_to(ROOT).as_posix())
    chunks = [
        "NOVA — CÓDIGO-FONTE CONSOLIDADO\n\nPacote textual; não é um executável. Binários nativos são gerados por Cargo/Maturin.\nNão inclui dados, chaves, ambientes virtuais, dependências baixadas ou checkpoints.\n\nÍNDICE\n"
    ]
    for path in ordered:
        content = path.read_bytes()
        name = path.relative_to(ROOT).as_posix()
        chunks.append(
            f"{name} | {len(content)} bytes | sha256={hashlib.sha256(content).hexdigest()}\n"
        )
    for path in ordered:
        name = path.relative_to(ROOT).as_posix()
        content = path.read_bytes().decode("utf-8", errors="replace")
        chunks.append(f"\n{'=' * 88}\nARQUIVO: {name}\n{'=' * 88}\n{content}\n")
    output = ROOT / ("artifacts/NOVA_Rust_completo.txt" if args.rust_only else "artifacts/NOVA_codigo_completo.txt")
    output.parent.mkdir(exist_ok=True)
    output.write_text("".join(chunks).rstrip() + "\n", encoding="utf-8")
    print(
        f"{output.relative_to(ROOT)}: {len(ordered)} arquivos, {output.stat().st_size} bytes"
    )


if __name__ == "__main__":
    main()
