"""Generate publication/exportable figures from recorded results, never invented data."""

from pathlib import Path
import csv
import os

os.environ.setdefault("MPLCONFIGDIR", "/tmp/nova-matplotlib")
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def main():
    root = Path("reports")
    with (root / "phase1.csv").open() as f:
        rows = list(csv.DictReader(f))
    fig, axes = plt.subplots(1, 2, figsize=(10, 4))
    for rank in (4, 8, 16, 32):
        data = [r for r in rows if int(r["rank"]) == rank]
        alpha = sorted({float(r["alpha"]) for r in data})
        means = [
            np.mean([float(r["mse_after"]) for r in data if float(r["alpha"]) == a])
            for a in alpha
        ]
        axes[0].plot(alpha, means, marker="o", label=f"rank={rank}")
    axes[0].set(xlabel="Overlap α", ylabel="New task MSE")
    axes[0].legend()
    axes[1].hist([float(r["eps_ret"]) for r in rows], bins=20)
    axes[1].set(xlabel="Retention error (float64)", ylabel="Conditions")
    fig.tight_layout()
    fig.savefig(root / "phase1.png", dpi=160)
    plt.close(fig)
    if (root / "phase3.csv").exists():
        with (root / "phase3.csv").open() as f:
            rows = list(csv.DictReader(f))
        datasets = list(dict.fromkeys(r["dataset"] for r in rows))
        fig, axes = plt.subplots(
            len(datasets), 2, figsize=(11, 4 * len(datasets)), squeeze=False
        )
        for row_axes, dataset in zip(axes, datasets):
            selected = [r for r in rows if r["dataset"] == dataset]
            methods = list(dict.fromkeys(r["method"] for r in selected))
            for ax, metric in zip(row_axes, ["acc", "fm"]):
                data = [
                    [float(r[metric]) for r in selected if r["method"] == m]
                    for m in methods
                ]
                ax.bar(
                    methods,
                    [np.mean(d) for d in data],
                    yerr=[np.std(d, ddof=1) for d in data],
                )
                ax.set_ylabel(metric)
                ax.set_title(dataset)
                ax.tick_params(axis="x", rotation=30)
        fig.tight_layout()
        fig.savefig(root / "phase3.png", dpi=160)
        plt.close(fig)


if __name__ == "__main__":
    main()
