#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=1 RAYON_NUM_THREADS=2
.venv/bin/python -m pytest -q "$@"
