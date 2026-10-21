"""Reformat existing observations without rerunning or inventing measurements."""

import csv
from pathlib import Path
import numpy as np
from experiments.common import write_report


def parse(value):
    if value == "":
        return ""
    if value in ("True", "False"):
        return value == "True"
    try:
        return int(value)
    except ValueError:
        try:
            return float(value)
        except ValueError:
            return value


def main():
    for phase in range(1, 13):
        path = Path(f"reports/fase{phase}.md")
        if not path.exists():
            continue
        paragraphs = path.read_text().split("\n\n")
        summary = paragraphs[1]
        limitations = paragraphs[-2]
        with Path(f"reports/phase{phase}.csv").open() as stream:
            rows = [{k: parse(v) for k, v in r.items()} for r in csv.DictReader(stream)]
        if phase == 3:
            for row in rows:
                a = np.load(
                    f"reports/accuracy_{row['dataset']}_{row['method']}_{row['seed']}.npy",
                    allow_pickle=False,
                )
                row["fm"] = float(
                    np.mean([a[j:-1, j].max() - a[-1, j] for j in range(len(a) - 1)])
                )
        write_report(phase, rows, summary, limitations)


if __name__ == "__main__":
    main()
