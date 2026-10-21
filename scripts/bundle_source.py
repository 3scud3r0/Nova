"""Create a deterministic, human-readable source bundle with per-file SHA-256."""

from pathlib import Path
import hashlib

ROOT = Path(__file__).resolve().parents[1]
DIRECTORIES = (
    "nova",
    "nova-core/src",
    "experiments",
    "tests",
    "scripts",
    "configs",
    ".github",
)
FILES = (
    "pyproject.toml",
    "requirements-cpu.txt",
    "nova-core/Cargo.toml",
    "nova-core/Cargo.lock",
    ".gitignore",
    "README.md",
    "DEVIATIONS.md",
    "docs/identity.md",
    "reports/STATUS.md",
)
EXTENSIONS = {".py", ".rs", ".sh", ".yaml", ".yml", ".toml", ".json"}


def main():
    paths = {ROOT / path for path in FILES}
    for directory in DIRECTORIES:
        paths.update(
            p
            for p in (ROOT / directory).rglob("*")
            if p.is_file() and p.suffix in EXTENSIONS and "__pycache__" not in p.parts
        )
    ordered = sorted(paths, key=lambda p: p.relative_to(ROOT).as_posix())
    chunks = [
        "NOVA — CÓDIGO-FONTE CONSOLIDADO\n\nPacote textual; não é um executável. Binários nativos são gerados por Maturin.\nNão inclui dados, chaves, ambientes virtuais, dependências baixadas ou checkpoints.\n\nÍNDICE\n"
    ]
    for path in ordered:
        content = path.read_bytes()
        name = path.relative_to(ROOT).as_posix()
        chunks.append(
            f"{name} | {len(content)} bytes | sha256={hashlib.sha256(content).hexdigest()}\n"
        )
    for path in ordered:
        name = path.relative_to(ROOT).as_posix()
        content = path.read_text()
        chunks.append(f"\n{'=' * 88}\nARQUIVO: {name}\n{'=' * 88}\n{content}\n")
    output = ROOT / "artifacts/NOVA_codigo_completo.txt"
    output.parent.mkdir(exist_ok=True)
    output.write_text("".join(chunks), encoding="utf-8")
    print(
        f"{output.relative_to(ROOT)}: {len(ordered)} arquivos, {output.stat().st_size} bytes"
    )


if __name__ == "__main__":
    main()
