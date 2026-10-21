"""CPU end-to-end latency includes FFI conversion; GPU/energy require hardware."""

from time import perf_counter_ns
import numpy as np
import torch
from nova.core import TernaryLinear
from experiments.common import write_report


def latency(fn, repeats=30):
    for _ in range(5):
        fn()
    values = []
    for _ in range(repeats):
        start = perf_counter_ns()
        fn()
        values.append((perf_counter_ns() - start) / 1e6)
    return float(np.median(values))


def main():
    torch.set_num_threads(2)
    rows = []
    for seed in range(5):
        rng = np.random.default_rng(seed)
        for batch, d, n in ((1, 128, 64), (32, 128, 64), (8, 512, 128)):
            w = rng.integers(-1, 2, (d, n), dtype=np.int8)
            x = rng.normal(size=(batch, d))
            native = TernaryLinear(w)
            expected = x @ w
            np.testing.assert_allclose(native(x), expected, atol=1e-10)
            packed_ms = latency(lambda: native(x))
            for dtype in (torch.float16, torch.bfloat16):
                tx = torch.tensor(x, dtype=dtype)
                tw = torch.tensor(w, dtype=dtype)
                ms = latency(lambda: tx @ tw)
                rows.append(
                    dict(
                        seed=seed,
                        batch=batch,
                        input_dim=d,
                        output_dim=n,
                        dtype=str(dtype),
                        packed_ms=packed_ms,
                        torch_ms=ms,
                        speedup=ms / packed_ms,
                        packed_weight_bytes=native.nbytes,
                        dense_weight_bytes=w.size * 2,
                        packed_gops=2 * batch * d * n / (packed_ms * 1e6),
                        energy_joules="",
                        gpu_available=torch.cuda.is_available(),
                        bitnet_cpp="not installed",
                    )
                )
    write_report(
        5,
        rows,
        "Kernel CPU Rust/PyO3, quatro pesos por byte, acumulação por adição/subtração. Comparação contra torch.matmul fp16/bf16 CPU; cinco sementes, mediana de 30 execuções.",
        "Bytes referem-se apenas aos pesos, não a todo o processo. Latência inclui cópias da fronteira Python/Rust. Nenhuma GPU/NVML nem bitnet.cpp disponíveis: energia e comparação bitnet não medidas. Ganho de compactação não implica ganho de latência. Kernel Triton opcional implementado, mas não executado sem CUDA; ver DEVIATIONS.md.",
    )


if __name__ == "__main__":
    main()
