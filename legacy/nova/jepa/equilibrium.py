"""Contractive rate-network latent learning via two-phase equilibrium correlations.

This backend uses NumPy and explicit local equations, with no autograd calls.
It is a separate hypothesis from the PyTorch JEPA baseline, not a claim that
latent prediction is automatically variational free-energy inference.
"""

from __future__ import annotations
from dataclasses import dataclass, asdict
import copy
from time import perf_counter
import numpy as np
from numpy.typing import ArrayLike


def batch(x: ArrayLike, width: int) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x[None]
    if x.ndim != 2 or x.shape[1] != width or not len(x) or not np.isfinite(x).all():
        raise ValueError(f"expected finite nonempty [batch, {width}] array")
    return x


@dataclass(frozen=True)
class EquilibriumConfig:
    state_dim: int = 32
    recurrent_radius: float = 0.5
    damping: float = 0.5
    beta: float = 0.02
    tolerance: float = 1e-8
    max_steps: int = 200
    update_clip: float = 1.0

    def __post_init__(self):
        if min(self.state_dim, self.max_steps) < 1 or not 0 < self.damping <= 1:
            raise ValueError("invalid relaxation configuration")
        if (
            not 0 <= self.recurrent_radius < 1
            or not 0 < self.beta < 1 - self.recurrent_radius
        ):
            raise ValueError("require recurrent_radius + beta < 1 for both phases")
        if (
            not np.isfinite(self.tolerance)
            or self.tolerance <= 0
            or not np.isfinite(self.update_clip)
            or self.update_clip <= 0
        ):
            raise ValueError("invalid tolerance or update clip")


@dataclass
class EquilibriumResult:
    state: np.ndarray
    output: np.ndarray
    iterations: int
    residual: float
    converged: bool


class EquilibriumNetwork:
    """E(s,u)=sum integral_0^s atanh(v)dv - s.T W s/2 - s.T(B.T u+b).

    State is in (-1,1). Hessian diag(1/(1-s²))-W is positive definite
    when symmetric ||W||_2<1. Free equilibrium solves s=tanh(sW+uB+b).
    Nudging adds beta/2 ||P s-y||², or beta*g.T P s for local messages.
    Central +/- beta phases estimate energy-parameter derivatives. This is a
    bounded nonlinear rate model; its symmetric weights are not a Dale circuit.
    """

    def __init__(
        self,
        inputs: int,
        outputs: int,
        *,
        seed: int = 0,
        config: EquilibriumConfig | None = None,
    ):
        self.config = config or EquilibriumConfig(state_dim=max(32, outputs * 2))
        if inputs < 1 or not 1 <= outputs <= self.config.state_dim:
            raise ValueError("invalid network dimensions")
        self.inputs, self.outputs = inputs, outputs
        rng = np.random.default_rng(seed)
        n = self.config.state_dim
        matrix = rng.normal(0, 0.1, (n, n))
        self.W = (matrix + matrix.T) / 2
        self.B = rng.normal(0, 1 / np.sqrt(inputs), (inputs, n))
        self.bias = np.zeros(n)
        self._contract()
        self.last_diagnostics = {}
        self.updates = 0

    def _contract(self):
        values, vectors = np.linalg.eigh((self.W + self.W.T) / 2)
        values = np.clip(
            values, -self.config.recurrent_radius, self.config.recurrent_radius
        )
        self.W = (vectors * values) @ vectors.T

    def energy(self, state: ArrayLike, inputs: ArrayLike) -> np.ndarray:
        state = batch(state, self.config.state_dim)
        u = batch(inputs, self.inputs)
        if len(state) != len(u):
            raise ValueError("batch mismatch")
        s = np.clip(state, -1 + 1e-12, 1 - 1e-12)
        primitive = s * np.arctanh(s) + 0.5 * np.log1p(-s * s)
        return (
            primitive.sum(1)
            - 0.5 * np.sum((s @ self.W) * s, axis=1)
            - np.sum(s * (u @ self.B + self.bias), axis=1)
        )

    def relax(
        self,
        inputs: ArrayLike,
        *,
        targets: ArrayLike | None = None,
        beta: float = 0.0,
        output_gradient: ArrayLike | None = None,
        initial: ArrayLike | None = None,
        deadline: float | None = None,
    ) -> EquilibriumResult:
        u = batch(inputs, self.inputs)
        c = self.config
        if abs(beta) + c.recurrent_radius >= 1:
            raise ValueError("nudge violates contraction bound")
        if targets is not None and output_gradient is not None:
            raise ValueError("choose targets or output_gradient")
        y = None if targets is None else batch(targets, self.outputs)
        gradient = (
            None if output_gradient is None else batch(output_gradient, self.outputs)
        )
        if (y is not None and len(y) != len(u)) or (
            gradient is not None and len(gradient) != len(u)
        ):
            raise ValueError("batch mismatch")
        s = (
            np.zeros((len(u), c.state_dim))
            if initial is None
            else batch(initial, c.state_dim).copy()
        )
        if len(s) != len(u):
            raise ValueError("initial batch mismatch")
        drive = u @ self.B + self.bias
        residual = float("inf")
        completed = 0
        for step in range(c.max_steps):
            if deadline is not None and perf_counter() >= deadline:
                break
            current = s @ self.W + drive
            if y is not None:
                current[:, -self.outputs :] -= beta * (s[:, -self.outputs :] - y)
            if gradient is not None:
                current[:, -self.outputs :] -= beta * gradient
            fixed = np.tanh(current)
            residual = float(np.max(abs(fixed - s)))
            completed = step + 1
            s += (fixed - s) * c.damping
            if residual <= c.tolerance:
                break
        # If no iteration fit the budget, report a finite bound, not a success.
        if not completed:
            residual = float(np.max(abs(np.tanh(drive) - s)))
        result = EquilibriumResult(
            s,
            s[:, -self.outputs :].copy(),
            completed,
            residual,
            bool(completed and residual <= c.tolerance),
        )
        self.last_diagnostics = {
            "iterations": completed,
            "residual": residual,
            "converged": result.converged,
        }
        return result

    def predict(self, inputs: ArrayLike) -> np.ndarray:
        result = self.relax(inputs)
        if not result.converged:
            raise RuntimeError("equilibrium inference did not converge")
        return result.output

    def learn(
        self,
        inputs: ArrayLike,
        targets: ArrayLike | None = None,
        *,
        output_gradient: ArrayLike | None = None,
        lr: float = 0.01,
    ) -> dict:
        u = batch(inputs, self.inputs)
        if (targets is None) == (output_gradient is None):
            raise ValueError("supply targets or a local output gradient")
        if not np.isfinite(lr) or lr < 0:
            raise ValueError("invalid learning rate")
        free = self.relax(u)
        beta = self.config.beta
        plus = self.relax(
            u,
            targets=targets,
            output_gradient=output_gradient,
            beta=beta,
            initial=free.state,
        )
        minus = self.relax(
            u,
            targets=targets,
            output_gradient=output_gradient,
            beta=-beta,
            initial=free.state,
        )
        if not all(r.converged for r in (free, plus, minus)):
            return {
                "updated": False,
                "reason": "relaxation_not_converged",
                "residual": max(r.residual for r in (free, plus, minus)),
                "input_gradient": np.zeros_like(u),
                "prediction": free.output,
            }
        delta = (plus.state - minus.state) / (2 * beta)
        # This input message is evaluated before modifying B.
        input_gradient = -delta @ self.B.T
        dB = u.T @ delta / len(u)
        dW = (plus.state.T @ plus.state - minus.state.T @ minus.state) / (
            4 * beta * len(u)
        )
        db = delta.mean(0)
        magnitude = np.sqrt(np.sum(dB * dB) + np.sum(dW * dW) + np.sum(db * db))
        scale = min(1.0, self.config.update_clip / max(magnitude, 1e-12))
        self.B += lr * scale * dB
        self.W += lr * scale * dW
        self.bias += lr * scale * db
        self._contract()
        self.updates += 1
        loss = (
            None
            if targets is None
            else float(
                0.5
                * np.mean(
                    np.sum((free.output - batch(targets, self.outputs)) ** 2, axis=1)
                )
            )
        )
        return {
            "updated": True,
            "loss": loss,
            "input_gradient": input_gradient,
            "prediction": free.output,
            "gradient_norm": float(magnitude),
            "clip_scale": float(scale),
            "residual": max(r.residual for r in (free, plus, minus)),
        }

    def linearize(self, inputs: ArrayLike) -> tuple[np.ndarray, np.ndarray]:
        """Implicit ds/du = (diag(1/(1-s²))-W)^(-1) B.T, not finite differences."""
        result = self.relax(inputs)
        if not result.converged:
            raise RuntimeError("cannot linearize a nonconverged equilibrium")
        jacobian = []
        for s in result.state:
            hessian = np.diag(1 / np.maximum(1 - s * s, 1e-12)) - self.W
            jacobian.append(np.linalg.solve(hessian, self.B.T)[-self.outputs :])
        return result.output, np.stack(jacobian)

    def state_dict(self) -> dict:
        return {
            "inputs": self.inputs,
            "outputs": self.outputs,
            "config": asdict(self.config),
            "W": self.W.copy(),
            "B": self.B.copy(),
            "bias": self.bias.copy(),
            "updates": self.updates,
        }

    @classmethod
    def from_state_dict(cls, state: dict) -> "EquilibriumNetwork":
        result = cls(
            state["inputs"],
            state["outputs"],
            config=EquilibriumConfig(**state["config"]),
        )
        for name in ("W", "B", "bias"):
            setattr(result, name, np.asarray(state[name], dtype=float).copy())
        if (
            not np.allclose(result.W, result.W.T, atol=1e-10)
            or np.linalg.norm(result.W, 2) > result.config.recurrent_radius + 1e-10
        ):
            raise ValueError("checkpoint violates symmetric contraction constraint")
        result.updates = state["updates"]
        return result


class EquilibriumWorldModel:
    """EMA-target latent prediction with an actual equilibrium encoder/predictor.

    During offline learning, local EqProp messages can also train the context
    encoder, with explicit variance/covariance output forces. Online runtime
    learning freezes the encoder to preserve protected coordinates. No lifetime
    or performance advantage follows merely from avoiding autograd.
    """

    kind = "equilibrium"

    def __init__(
        self,
        observation_dim: int,
        latent_dim: int,
        action_dim: int,
        *,
        seed: int = 0,
        config: EquilibriumConfig | None = None,
    ):
        self.observation_dim, self.latent_dim, self.action_dim = (
            observation_dim,
            latent_dim,
            action_dim,
        )
        self.config = config or EquilibriumConfig(state_dim=max(32, latent_dim * 2))
        self.context = EquilibriumNetwork(
            observation_dim, latent_dim, seed=seed, config=self.config
        )
        self.target = copy.deepcopy(self.context)
        self.predictor = EquilibriumNetwork(
            latent_dim + action_dim, latent_dim, seed=seed + 1, config=self.config
        )
        self.mean = np.zeros(observation_dim)
        self.scale = np.ones(observation_dim)
        self.encoder_frozen = False
        self.last_diagnostics = {}

    def fit_normalizer(self, observations: ArrayLike):
        if self.encoder_frozen:
            raise ValueError("normalizer is frozen with encoder coordinates")
        x = batch(observations, self.observation_dim)
        self.mean = x.mean(0)
        self.scale = np.maximum(x.std(0), 0.05)

    def _normalize(self, x):
        return (batch(x, self.observation_dim) - self.mean) / self.scale

    def encode(self, x: ArrayLike) -> np.ndarray:
        output = self.context.predict(self._normalize(x))
        self.last_diagnostics = self.context.last_diagnostics.copy()
        return output

    def predict(self, z: ArrayLike, action: ArrayLike) -> np.ndarray:
        z = batch(z, self.latent_dim)
        a = batch(action, self.action_dim)
        if len(z) != len(a):
            raise ValueError("latent/action batch mismatch")
        return self.predictor.predict(np.c_[z, a])

    def linearize(
        self, z: ArrayLike, action: ArrayLike
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        z = batch(z, self.latent_dim)
        a = batch(action, self.action_dim)
        output, jacobian = self.predictor.linearize(np.c_[z, a])
        return (
            output,
            jacobian[:, :, : self.latent_dim],
            jacobian[:, :, self.latent_dim :],
        )

    def learn_latent(self, z, action, future_z, lr=0.01) -> dict:
        return self.predictor.learn(
            np.c_[batch(z, self.latent_dim), batch(action, self.action_dim)],
            batch(future_z, self.latent_dim),
            lr=lr,
        )

    def learn_transition(
        self,
        x,
        action,
        future,
        *,
        lr=0.01,
        train_encoder=False,
        variance_weight=1.0,
        covariance_weight=0.01,
        ema=0.99,
    ) -> dict:
        if train_encoder and self.encoder_frozen:
            raise ValueError("encoder coordinates are frozen")
        normalized = self._normalize(x)
        z = self.context.predict(normalized)
        target = self.target.predict(self._normalize(future))
        result = self.learn_latent(z, action, target, lr)
        if train_encoder and result["updated"]:
            gradient = result["input_gradient"][:, : self.latent_dim]
            centered = z - z.mean(0)
            n, d = z.shape
            std = np.sqrt(np.mean(centered**2, axis=0) + 1e-4)
            if n > 1:
                # Output-gradient arrays are per-example cost gradients; network
                # learn performs its own batch mean on parameter correlations.
                gradient += (
                    variance_weight
                    * (-centered / np.maximum(std, 1e-8))
                    * (std < 0.5)
                    / d
                )
                cov = centered.T @ centered / (n - 1)
                off = cov - np.diag(np.diag(cov))
                gradient += (
                    covariance_weight * 4 * n / (d * d * (n - 1)) * (centered @ off)
                )
            result["encoder_updated"] = self.context.learn(
                normalized, output_gradient=gradient, lr=lr
            )["updated"]
            for name in ("W", "B", "bias"):
                setattr(
                    self.target,
                    name,
                    ema * getattr(self.target, name)
                    + (1 - ema) * getattr(self.context, name),
                )
        result["latent_std"] = float(z.std(0).mean())
        return result

    def freeze_encoder(self):
        self.encoder_frozen = True

    def state_dict(self) -> dict:
        return {
            "kind": self.kind,
            "observation_dim": self.observation_dim,
            "latent_dim": self.latent_dim,
            "action_dim": self.action_dim,
            "config": asdict(self.config),
            "context": self.context.state_dict(),
            "target": self.target.state_dict(),
            "predictor": self.predictor.state_dict(),
            "mean": self.mean.copy(),
            "scale": self.scale.copy(),
            "encoder_frozen": self.encoder_frozen,
        }

    @classmethod
    def from_state_dict(cls, state: dict) -> "EquilibriumWorldModel":
        obj = cls(
            state["observation_dim"],
            state["latent_dim"],
            state["action_dim"],
            config=EquilibriumConfig(**state["config"]),
        )
        for name in ("context", "target", "predictor"):
            setattr(obj, name, EquilibriumNetwork.from_state_dict(state[name]))
        obj.mean = np.asarray(state["mean"]).copy()
        obj.scale = np.asarray(state["scale"]).copy()
        obj.encoder_frozen = state["encoder_frozen"]
        return obj
