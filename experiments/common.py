"""Machine-readable evidence, grouped conditions and reproducibility metadata."""

from pathlib import Path
from datetime import datetime, timezone
from importlib.metadata import version, PackageNotFoundError
import csv
import hashlib
import json
import platform
import numpy as np
from scipy.stats import ttest_rel

GROUPS = {
    1: ("rank", "alpha"),
    3: ("dataset", "method"),
    5: ("batch", "input_dim", "output_dim", "dtype"),
    7: ("condition", "current_pa"),
    8: ("condition", "budget"),
}


def source_digest():
    digest = hashlib.sha256()
    files = sorted(
        [
            *Path("nova").rglob("*.py"),
            *Path("experiments").glob("*.py"),
            *Path("nova-core/src").glob("*.rs"),
        ]
    )
    for file in files:
        digest.update(str(file).encode())
        digest.update(file.read_bytes())
    return digest.hexdigest()


def aggregate(rows, keys):
    return {
        key: {
            "mean": float(np.mean(values)),
            "std": float(np.std(values, ddof=1)) if len(values) > 1 else 0.0,
        }
        for key in keys
        if key != "seed"
        if (values := [r[key] for r in rows if isinstance(r.get(key), (float, int))])
    }


def write_report(
    phase: int, rows: list[dict], summary: str, limitations: str = ""
) -> None:
    root = Path("reports")
    root.mkdir(exist_ok=True)
    keys = sorted(set().union(*(r.keys() for r in rows)))
    with (root / f"phase{phase}.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, keys)
        writer.writeheader()
        writer.writerows(rows)
    group_keys = GROUPS.get(phase, ())
    conditions = {}
    for row in rows:
        label = (
            ", ".join(
                f"{key}={row.get(key, '')}"
                for key in group_keys
                if row.get(key, "") != ""
            )
            or "all seeds"
        )
        conditions.setdefault(label, []).append(row)
    grouped = {
        label: aggregate(group, [key for key in keys if key not in group_keys])
        for label, group in conditions.items()
    }
    packages = {}
    for package in ("numpy", "scipy", "torch", "pytest", "nova-native"):
        try:
            packages[package] = version(package)
        except PackageNotFoundError:
            packages[package] = "not installed"
    metadata = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "report_generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "packages": packages,
        "report_source_sha256": source_digest(),
        "observations": len(rows),
        "groups": grouped,
    }
    (root / f"phase{phase}.json").write_text(
        json.dumps(metadata, indent=2, allow_nan=False)
    )
    table = "\n".join(
        f"| {label} | {metric} | {stats['mean']:.6g} | {stats['std']:.6g} |"
        for label, metrics in grouped.items()
        for metric, stats in metrics.items()
    )
    (root / f"fase{phase}.md").write_text(
        f"# Fase {phase}\n\n{summary}\n\n| Condição | Métrica | Média | Desvio amostral |\n|---|---|---:|---:|\n{table}\n\n{limitations}\n\nDados: `phase{phase}.csv`; grupos não misturam métodos ou orçamentos.\n"
    )


def paired(a, b):
    a, b = np.asarray(a), np.asarray(b)
    if np.allclose(a, b):
        return 1.0
    return float(ttest_rel(a, b).pvalue)
