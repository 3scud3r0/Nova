"""Background symbolic regression using a separate process; results remain candidates."""

from concurrent.futures import ProcessPoolExecutor
import multiprocessing
import numpy as np


def _fit_pysr(x, y, iterations, seed):
    from pysr import PySRRegressor

    model = PySRRegressor(
        niterations=iterations,
        binary_operators=["+", "-", "*", "/"],
        unary_operators=["sin", "cos", "sqrt"],
        maxsize=24,
        random_state=seed,
        deterministic=True,
        parallelism="serial",
    )
    model.fit(x, y)
    records = []
    for _, row in model.equations_.iterrows():
        records.append(
            dict(
                equation=str(row["equation"]),
                loss=float(row["loss"]),
                complexity=int(row["complexity"]),
            )
        )
    return dict(
        status="candidate-not-verified",
        pareto=records,
        scope="PySR fit over supplied observations, not an exact-law guarantee",
    )


class SymbolicDistiller:
    def __init__(self, *, seed=42, iterations=40):
        if not 1 <= iterations <= 1000:
            raise ValueError("invalid PySR iteration budget")
        self.seed, self.iterations = seed, iterations
        self.pool = ProcessPoolExecutor(
            max_workers=1, mp_context=multiprocessing.get_context("spawn")
        )
        self.future = None

    def submit(self, predictors, acceleration):
        x, y = np.asarray(predictors, float), np.asarray(acceleration, float)
        if (
            x.ndim != 2
            or y.shape != (len(x),)
            or x.size > 2_000_000
            or len(x) < 16
            or not np.isfinite(x).all()
            or not np.isfinite(y).all()
        ):
            raise ValueError("invalid aligned symbolic samples")
        if self.future is not None and not self.future.done():
            raise RuntimeError("symbolic job already running")
        self.future = self.pool.submit(
            _fit_pysr, x.copy(), y.copy(), self.iterations, self.seed
        )

    def poll(self):
        if self.future is None or not self.future.done():
            return None
        future, self.future = self.future, None
        try:
            return future.result()
        except Exception as error:
            return dict(status="failed", reason=f"{type(error).__name__}: {error}")

    def close(self, *, wait=True):
        self.pool.shutdown(wait=wait, cancel_futures=True)
