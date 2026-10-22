"""Mirror canonical browser WGSL into the crate for Naga build-time validation."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "nova/visuals/shaders"
TARGET = ROOT / "nova-core/src/compute_shaders/chromatic"


def main():
    TARGET.mkdir(parents=True, exist_ok=True)
    for shader in sorted(SOURCE.glob("*.wgsl")):
        (TARGET / shader.name).write_bytes(shader.read_bytes())
    expected = {p.name for p in SOURCE.glob("*.wgsl")}
    for stale in TARGET.glob("*.wgsl"):
        if stale.name not in expected:
            stale.unlink()
    print(f"{len(expected)} canonical WGSL assets synchronized")


if __name__ == "__main__":
    main()
