import torch
from nova.jepa import JEPA
from nova.environments import LinearPoint, Pendulum, GridWorld


def test_target_stop_gradient_and_ema():
    torch.manual_seed(0)
    model = JEPA(6, 4, 2)
    old = [p.clone() for p in model.target.parameters()]
    loss, metrics = model.loss(
        torch.randn(32, 6), torch.randn(32, 2), torch.randn(32, 6)
    )
    loss.backward()
    assert all(p.grad is None for p in model.target.parameters())
    assert any(p.grad is not None for p in model.context.parameters())
    with torch.no_grad():
        for p in model.context.parameters():
            p.add_(0.1)
    model.target.update(model.context, 0.5)
    for before, after in zip(old, model.target.parameters()):
        torch.testing.assert_close(after, before + 0.05)
    assert metrics["latent_std"] > 0


def test_environments():
    for env, action in [(LinearPoint(), [0, 0]), (Pendulum(), [0]), (GridWorld(), 0)]:
        assert env.reset().ndim == 1
        for _ in range(100):
            obs, reward, done, info = env.step(action)
            assert torch.isfinite(torch.as_tensor(obs)).all()
