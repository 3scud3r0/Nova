"""Explicit diffusion cascade, three-factor plasticity, and homeostasis."""

import numpy as np
from scipy.linalg import expm


class DiffusiveCascade:
    """C_i du_i/dt = g_(i-1)(u_(i-1)-u_i)+g_i(u_(i+1)-u_i)-lambda_i*u_i+I_i.

    C_i=b**i, g_i=kappa*b**(-i), reflecting endpoints and configurable leak.
    This declared diffusion model is not the absent conversation's exact equations.
    """

    def __init__(self, synapses=1, reservoirs=4, b=2.0, kappa=1.0, leak=0.001):
        if min(synapses, reservoirs) < 1 or b <= 1 or kappa < 0 or leak < 0:
            raise ValueError("invalid cascade")
        self.capacity = b ** np.arange(reservoirs)
        self.state = np.zeros((synapses, reservoirs))
        self.matrix = np.diag(-np.full(reservoirs, leak) / self.capacity)
        for i in range(reservoirs - 1):
            g = kappa * b ** (-i)
            self.matrix[i, i] -= g / self.capacity[i]
            self.matrix[i, i + 1] += g / self.capacity[i]
            self.matrix[i + 1, i] += g / self.capacity[i + 1]
            self.matrix[i + 1, i + 1] -= g / self.capacity[i + 1]

    def step(self, drive=0.0, dt=0.1, method="rk4"):
        if dt <= 0:
            raise ValueError("dt must be positive")
        force = np.zeros_like(self.state)
        force[:, 0] = drive
        f = lambda u: u @ self.matrix.T + force
        if method == "euler":
            if dt * max(abs(np.linalg.eigvals(self.matrix))) > 1:
                raise ValueError("unstable Euler step")
            self.state += dt * f(self.state)
        elif method == "rk4":
            if dt * max(abs(np.linalg.eigvals(self.matrix))) > 2.5:
                raise ValueError("unstable RK4 step")
            k1 = f(self.state)
            k2 = f(self.state + dt * k1 / 2)
            k3 = f(self.state + dt * k2 / 2)
            k4 = f(self.state + dt * k3)
            self.state += dt * (k1 + 2 * k2 + 2 * k3 + k4) / 6
        else:
            raise ValueError("method must be euler or rk4")
        return self.state[:, 0].copy()

    def analytic(self, t):
        return self.state @ expm(t * self.matrix).T

    def expressed(self, beta=None):
        return self.state @ (
            np.eye(1, self.state.shape[1])[0] if beta is None else np.asarray(beta)
        )

    def consolidate(self, amount):
        """Conserve capacity-weighted mass while moving fast state to slow."""
        fraction = float(np.clip(amount, 0, 1))
        if self.state.shape[1] > 1:
            mass = self.state[:, 0] * fraction * self.capacity[0]
            self.state[:, 0] -= mass / self.capacity[0]
            self.state[:, -1] += mass / self.capacity[-1]


class ThreeFactorRule:
    """Spike STDP eligibility: pre_trace*post - post_trace*pre, gated by M(t)."""

    def __init__(self, pre, post, tau=20.0):
        self.pre = np.zeros(pre)
        self.post = np.zeros(post)
        self.tau = tau

    def step(self, pre, post, modulator, dt=1.0, lr=0.001):
        self.pre *= np.exp(-dt / self.tau)
        self.post *= np.exp(-dt / self.tau)
        eligibility = np.outer(self.pre, post) - np.outer(pre, self.post)
        self.pre += pre
        self.post += post
        return lr * modulator * eligibility


def oja(weights, pre, post, lr=0.001, modulator=1.0):
    return weights + lr * modulator * (np.outer(pre, post) - weights * np.square(post))


def homeostatic_scale(weights, rates, target=5.0, eta=0.01):
    return weights * np.exp(np.clip(eta * (target - np.asarray(rates)), -0.1, 0.1))


def prune(weights, rigidity, threshold=0.001):
    result = np.array(weights, copy=True)
    result[(abs(result) < threshold) & (np.asarray(rigidity) < threshold)] = 0
    return result


class NativeDiffusiveCascade(DiffusiveCascade):
    """Same declared equations, contiguous Rust/Rayon RK4 implementation."""

    def step(self, drive=0.0, dt=0.1, method="rk4"):
        if method != "rk4":
            return super().step(drive, dt, method)
        if dt <= 0 or dt * max(abs(np.linalg.eigvals(self.matrix))) > 2.5:
            raise ValueError("unstable RK4 step")
        from nova.core import require_native

        force = np.broadcast_to(np.asarray(drive, dtype=float), (len(self.state),))
        result = require_native().cascade_rk4(
            self.state.ravel().tolist(),
            self.matrix.ravel().tolist(),
            force.tolist(),
            self.state.shape[1],
            dt,
        )
        self.state = np.asarray(result).reshape(self.state.shape)
        return self.state[:, 0].copy()
