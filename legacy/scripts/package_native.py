"""Package already-built native artifacts; does not execute the application or tests."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default="release", choices=("release", "debug"))
    parser.add_argument("--target", default=None)
    parser.add_argument("--label", default=f"{platform.system().lower()}-{platform.machine()}")
    args = parser.parse_args()
    build = ROOT / "target"
    if args.target:
        build /= args.target
    build /= args.profile
    system = platform.system()
    names = {"Windows": ("nova.exe", "nova.dll"), "Darwin": ("nova", "libnova.dylib"),
             "Linux": ("nova", "libnova.so")}[system]
    sources = [build / n for n in names]
    headers = sorted((build / "build").glob("nova-ffi-*/out/nova.h"), key=lambda p:p.stat().st_mtime)
    if not headers:
        raise SystemExit("generated C header missing; build nova-ffi first")
    sources += [headers[-1], ROOT / "docs/native/README.md", ROOT / "docs/native/STATUS.md", ROOT / "docs/native/FUSION.md", ROOT / "docs/native/EVOLUTION.md", ROOT / "LICENSE", ROOT / "THIRD_PARTY_NOTICES.md", ROOT / "artifacts/NOVA_codigo_completo.txt", ROOT / "artifacts/NOVA_Rust_completo.txt"]
    if not all(p.is_file() for p in sources):
        raise SystemExit("missing release artifacts; build nova-engine and nova-ffi first")
    destination = ROOT / "dist"
    destination.mkdir(exist_ok=True)
    output = destination / f"nova-{args.label}.zip"
    checksums = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for p in sources:
            archive.write(p, p.name)
        archive.writestr("SHA256SUMS.json", json.dumps(checksums, indent=2) + "\n")
    output.with_suffix(".zip.sha256").write_text(hashlib.sha256(output.read_bytes()).hexdigest()+"  "+output.name+"\n")
    print(output.relative_to(ROOT))


if __name__ == "__main__":
    main()
