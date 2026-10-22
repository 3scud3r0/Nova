"""Explicit local Avida subprocess adapter; PVM is not an Avida CPU implementation."""
from pathlib import Path
import subprocess


def run(config, *, executable="avida", output="runs/avida", timeout=3600):
    config = Path(config).resolve()
    if not config.is_file():
        raise FileNotFoundError(config)
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    with (output / "stdout.log").open("w") as stdout, (output / "stderr.log").open("w") as stderr:
        proc = subprocess.run([executable, "-c", str(config)], cwd=output,
                              stdout=stdout, stderr=stderr, timeout=timeout)
    if proc.returncode:
        raise RuntimeError(f"Avida exited {proc.returncode}; inspect {output / 'stderr.log'}")
    return output
