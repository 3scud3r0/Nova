"""Opt-in hypotheses: mathematical checks do not establish task-level benefit."""

import numpy as np


class PhaseOscillatorLayer:
    """dtheta_i/dt=omega_i+K/N sum_j A_ij sin(theta_j-theta_i-alpha_ij)."""

    def __init__(
        self, size=32, coupling=2.0, seed=0, adjacency=None, lag=None, backend="numpy"
    ):
        rng = np.random.default_rng(seed)
        self.theta = rng.uniform(-np.pi, np.pi, size)
        self.omega = rng.normal(0, 0.1, size)
        self.coupling = coupling
        self.adjacency = (
            np.ones((size, size))
            if adjacency is None
            else np.asarray(adjacency, dtype=float)
        )
        self.lag = (
            np.zeros((size, size)) if lag is None else np.asarray(lag, dtype=float)
        )
        if self.adjacency.shape != (size, size) or self.lag.shape != (size, size):
            raise ValueError("invalid coupling shape")
        self.backend = backend

    def step(self, dt=0.01):
        if dt <= 0:
            raise ValueError("dt must be positive")
        if self.backend == "rust":
            from nova.core import require_native

            self.theta = np.asarray(
                require_native().kuramoto_step(
                    self.theta.tolist(),
                    self.omega.tolist(),
                    self.adjacency.ravel().tolist(),
                    self.lag.ravel().tolist(),
                    self.coupling,
                    dt,
                )
            )
        elif self.backend == "numpy":
            derivative = self.omega + self.coupling * np.mean(
                self.adjacency
                * np.sin(self.theta[None, :] - self.theta[:, None] - self.lag),
                axis=1,
            )
            self.theta = (self.theta + dt * derivative) % (2 * np.pi)
        else:
            raise ValueError("backend must be numpy or rust")
        return self.theta.copy()

    @property
    def order(self):
        return float(abs(np.exp(1j * self.theta).mean()))


class QuadraticEquilibriumPropagation:
    """E(s)=1/2 s.T A s-s.T Bx; C=1/2 ||P s-y||².

    Free and nudged equilibria are reached by actual relaxation. Parameter
    gradient is -(s_beta-s_free)x.T/beta, compared to implicit backprop.
    A is symmetric positive definite; this is a small quadratic validation model.
    """

    def __init__(self, inputs=3, state=5, outputs=2, seed=0):
        rng = np.random.default_rng(seed)
        m = rng.normal(0, 0.1, (state, state))
        self.A = np.eye(state) + m.T @ m
        self.B = rng.normal(0, 0.2, (state, inputs))
        self.P = np.eye(state)[-outputs:]
        self.last_iterations = (0, 0)

    def relax(
        self, x, y=None, beta=0.0, initial=None, tolerance=1e-11, max_steps=10000
    ):
        if beta < 0:
            raise ValueError("beta must be nonnegative")
        s = np.zeros(len(self.A)) if initial is None else initial.copy()
        matrix = self.A + beta * self.P.T @ self.P
        drive = self.B @ x + (beta * self.P.T @ y if y is not None else 0)
        dt = 0.8 / np.linalg.eigvalsh(matrix).max()
        for i in range(max_steps):
            gradient = matrix @ s - drive
            if np.linalg.norm(gradient) < tolerance:
                return s, i
            s -= dt * gradient
        raise RuntimeError("equilibrium did not converge")

    def gradient(self, x, y, beta=1e-4):
        if beta <= 0:
            raise ValueError("beta must be positive")
        free, n0 = self.relax(x)
        nudged, nb = self.relax(x, y, beta, free)
        self.last_iterations = (n0, nb)
        return -np.outer(nudged - free, x) / beta


class SheafCoherence:
    """Cellular sheaf coboundary D_e x = R_eu x_u - R_ev x_v; L=D.T D."""

    def __init__(self, nodes, stalk_dim, edges, restrictions=None):
        self.D = np.zeros((len(edges) * stalk_dim, nodes * stalk_dim))
        for i, (u, v) in enumerate(edges):
            if not 0 <= u < nodes or not 0 <= v < nodes or u == v:
                raise ValueError("invalid edge")
            ru, rv = (
                (np.eye(stalk_dim), np.eye(stalk_dim))
                if restrictions is None
                else restrictions[i]
            )
            self.D[
                i * stalk_dim : (i + 1) * stalk_dim, u * stalk_dim : (u + 1) * stalk_dim
            ] = ru
            self.D[
                i * stalk_dim : (i + 1) * stalk_dim, v * stalk_dim : (v + 1) * stalk_dim
            ] = -rv
        self.L = self.D.T @ self.D

    def energy(self, x):
        return float(np.linalg.norm(self.D @ np.asarray(x).ravel()) ** 2 / 2)

    def diffuse(self, x, steps=20, dt=None):
        x = np.asarray(x, dtype=float)
        shape = x.shape
        x = x.ravel().copy()
        maximum = np.linalg.eigvalsh(self.L).max()
        if maximum == 0:
            return x.reshape(shape)
        dt = 0.9 / maximum if dt is None else dt
        if dt <= 0 or dt * maximum >= 2:
            raise ValueError("unstable diffusion step")
        for _ in range(steps):
            x -= dt * self.L @ x
        return x.reshape(shape)
