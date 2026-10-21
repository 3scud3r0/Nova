#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python -m venv --system-site-packages .venv
.venv/bin/python -m pip install --disable-pip-version-check -r requirements-cpu.txt
.venv/bin/python -m pip install --disable-pip-version-check --no-deps -e .
# Rust is optional for Python work. Install through rustup with verified TLS.
if command -v cargo >/dev/null 2>&1; then
  .venv/bin/maturin build --manifest-path nova-core/Cargo.toml --release --locked -o .cache/wheels
  .venv/bin/python -m pip install --force-reinstall .cache/wheels/*.whl
elif [ -x .tools/cargo/bin/cargo ]; then
  export CARGO_HOME="$PWD/.tools/cargo"
  export RUSTUP_HOME="$PWD/.tools/rustup"
  export PATH="$CARGO_HOME/bin:$PATH"
  .venv/bin/maturin build --manifest-path nova-core/Cargo.toml --release --locked -o .cache/wheels
  .venv/bin/python -m pip install --force-reinstall .cache/wheels/*.whl
else
  printf '%s\n' 'Rust unavailable: Python installed; install Rust >=1.85 and rerun to build native kernels.'
fi
