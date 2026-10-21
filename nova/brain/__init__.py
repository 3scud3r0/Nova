"""Sparse E/PV/SST/VIP microcircuit and external-reference comparison tools."""

import csv
import numpy as np
from scipy import sparse
from scipy.signal import welch
from nova.neuron import AdExPopulation


class Microcircuit:
    def __init__(self, units=200, seed=0, backend="numpy", density=0.05):
        self.neurons = AdExPopulation(units, seed, backend)
        rng = np.random.default_rng(seed)
        types = self.neurons.types
        matrix = sparse.random(
            units,
            units,
            density=density,
            random_state=rng,
            data_rvs=lambda n: rng.uniform(5, 20, n),
        ).tocoo()
        keep = (matrix.row != matrix.col) & (
            (types[matrix.row] != 3) | (types[matrix.col] == 2)
        )
        rows, cols = matrix.row[keep], matrix.col[keep]
        sign = np.where(types[rows] == 0, 1.0, -1.0)
        self.weights = sparse.csr_matrix(
            (matrix.data[keep] * sign, (rows, cols)), shape=(units, units)
        )
        self.sst_weights = sparse.diags((types == 2).astype(float)) @ self.weights
        self.somatic_weights = self.weights - self.sst_weights
        self.trace = np.zeros(units)

    def step(self, drive=300.0, dt=0.1):
        self.trace *= np.exp(-dt / 5)
        basal = drive + self.somatic_weights.T @ self.trace
        apical = self.sst_weights.T @ self.trace
        spikes, state = self.neurons.step((basal, apical), dt=dt)
        self.trace += spikes
        return spikes, state

    def check_dale(self):
        for i in range(self.weights.shape[0]):
            row = self.weights.getrow(i).data
            if not (
                np.all(row >= 0) if self.neurons.types[i] == 0 else np.all(row <= 0)
            ):
                return False
        return True


def spectral_metrics(spikes, dt_ms):
    population = np.asarray(spikes, dtype=float).mean(axis=1) * 1000 / dt_ms
    f, p = welch(population, fs=1000 / dt_ms, nperseg=min(2048, len(population)))
    total = np.trapezoid(p, f)
    band = (f >= 30) & (f <= 80)
    return {
        "mean_rate_hz": float(population.mean()),
        "peak_hz": float(f[np.argmax(p)]),
        "gamma_fraction": float(np.trapezoid(p[band], f[band]) / total)
        if total
        else 0.0,
    }


def compare_reference(observed, reference_csv):
    """CSV metric,value,tolerance,source; data provenance is mandatory."""
    results = []
    with open(reference_csv, newline="") as stream:
        for row in csv.DictReader(stream):
            if not row.get("source"):
                raise ValueError("biological reference needs provenance")
            metric = row["metric"]
            expected = float(row["value"])
            tol = float(row["tolerance"])
            if tol < 0:
                raise ValueError("negative tolerance")
            actual = observed.get(metric)
            results.append(
                dict(
                    metric=metric,
                    observed=actual,
                    reference=expected,
                    tolerance=tol,
                    source=row["source"],
                    status="unrun"
                    if actual is None
                    else "passed"
                    if abs(actual - expected) <= tol
                    else "failed",
                )
            )
    return results


def load_connectome(path, nodes):
    """Edge CSV source,target,weight; preserve signed topology, no synthetic data label."""
    rows = []
    cols = []
    values = []
    with open(path, newline="") as stream:
        for e in csv.DictReader(stream):
            u, v = int(e["source"]), int(e["target"])
            if not 0 <= u < nodes or not 0 <= v < nodes:
                raise ValueError("connectome node out of range")
            rows.append(u)
            cols.append(v)
            values.append(float(e["weight"]))
    return sparse.csr_matrix((values, (rows, cols)), shape=(nodes, nodes))
