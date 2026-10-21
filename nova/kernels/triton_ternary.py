"""Optional GPU reference kernel: 2-bit weights, signed additions, no dense GEMM.

Requires Triton and CUDA. This intentionally simple kernel needs benchmarking;
compaction alone is not evidence of lower latency or energy.
"""

import torch


def pack_ternary(weights):
    if (
        weights.ndim != 2
        or not torch.isin(
            weights, torch.tensor([-1, 0, 1], device=weights.device)
        ).all()
    ):
        raise ValueError("expected ternary matrix")
    flat = weights.flatten()
    codes = torch.where(flat == -1, 2, flat).to(torch.uint8)
    padded = torch.zeros(
        ((len(codes) + 3) // 4) * 4, dtype=torch.uint8, device=weights.device
    )
    padded[: len(codes)] = codes
    padded = padded.reshape(-1, 4)
    return (
        padded[:, 0] | (padded[:, 1] << 2) | (padded[:, 2] << 4) | (padded[:, 3] << 6)
    )


def matmul(x, packed, out_features):
    if not x.is_cuda or not packed.is_cuda:
        raise ValueError("CUDA tensors required")
    if (
        x.ndim != 2
        or not x.is_contiguous()
        or packed.dtype != torch.uint8
        or out_features < 1
    ):
        raise ValueError("invalid tensor layout")
    if packed.numel() != (x.shape[1] * out_features + 3) // 4:
        raise ValueError("packed dimensions mismatch")
    import triton
    import triton.language as tl

    @triton.jit
    def kernel(X, W, Y, D: tl.constexpr, N: tl.constexpr, BLOCK: tl.constexpr):
        row = tl.program_id(0)
        cols = tl.program_id(1) * BLOCK + tl.arange(0, BLOCK)
        acc = tl.full((BLOCK,), 0, tl.float32)
        for k in range(D):
            index = k * N + cols
            bits = tl.load(W + index // 4, cols < N, other=0)
            code = (bits >> (2 * (index % 4))) & 3
            value = tl.load(X + row * D + k).to(tl.float32)
            acc += tl.where(code == 1, value, tl.where(code == 2, -value, 0.0))
        tl.store(Y + row * N + cols, acc, cols < N)

    y = torch.empty((len(x), out_features), device=x.device, dtype=x.dtype)
    kernel[(len(x), triton.cdiv(out_features, 64))](
        x, packed, y, x.shape[1], out_features, 64
    )
    return y
