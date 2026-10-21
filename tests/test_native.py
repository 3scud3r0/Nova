import numpy as np
import pytest
from nova.core import TernaryLinear, fast_hadamard_transform, available

pytestmark = pytest.mark.skipif(
    not available(), reason="native extension not installed"
)


@pytest.mark.parametrize("shape", [(7, 5), (64, 16), (1, 1)])
def test_packed_equivalence(shape):
    rng = np.random.default_rng(8)
    w = rng.integers(-1, 2, shape, dtype=np.int8)
    x = rng.normal(size=(4, shape[0]))
    native = TernaryLinear(w)
    np.testing.assert_allclose(native(x), x @ w, atol=1e-12)
    assert native.nbytes == (w.size + 3) // 4
    with pytest.raises(ValueError):
        native(np.ones((2, shape[0] + 1)))


def test_native_hadamard():
    x = np.arange(16, dtype=float)
    np.testing.assert_allclose(fast_hadamard_transform(fast_hadamard_transform(x)), x)
    with pytest.raises(ValueError):
        fast_hadamard_transform([1, 2, 3])


def test_gpu_kernel_when_available():
    torch = pytest.importorskip("torch")
    if not torch.cuda.is_available():
        pytest.skip("CUDA hardware unavailable")
    pytest.importorskip("triton")
    from nova.kernels.triton_ternary import pack_ternary, matmul

    x = torch.randn(4, 13, device="cuda")
    w = torch.randint(-1, 2, (13, 9), device="cuda")
    torch.testing.assert_close(
        matmul(x, pack_ternary(w), 9), x @ w.float(), atol=1e-5, rtol=1e-5
    )
