"""Seeded virtual bodies with independent observation noise and distractors."""

from __future__ import annotations
import numpy as np


class LinearPoint:
    def __init__(self, seed=0, distractors=8, noise=0.01):
        self.rng = np.random.default_rng(seed)
        self.distractors, self.noise = distractors, noise
        self.state = np.zeros(4)

    def observe(self):
        return np.r_[
            self.state + self.rng.normal(0, self.noise, 4),
            self.rng.normal(size=self.distractors),
        ]

    def reset(self):
        self.state = self.rng.normal(0, 0.5, 4)
        return self.observe()

    def step(self, action):
        action = np.clip(np.asarray(action), -1, 1)
        self.state[2:] = 0.9 * self.state[2:] + 0.1 * action
        self.state[:2] += 0.1 * self.state[2:]
        return self.observe(), -float(self.state[:2] @ self.state[:2]), False, {}


class Pendulum:
    """theta'' = -g/l sin(theta) - damping*theta' + torque; semi-implicit Euler."""

    def __init__(self, seed=0, dt=0.02, noise=0.01):
        self.rng = np.random.default_rng(seed)
        self.dt, self.noise = dt, noise
        self.state = np.zeros(2)

    def observe(self):
        t, v = self.state
        return np.array([np.cos(t), np.sin(t), v]) + self.rng.normal(0, self.noise, 3)

    def reset(self):
        self.state = self.rng.uniform(-1, 1, 2)
        return self.observe()

    def step(self, action):
        t, v = self.state
        v += self.dt * (
            -9.81 * np.sin(t)
            - 0.1 * v
            + float(np.clip(np.asarray(action).item(), -2, 2))
        )
        self.state = np.array([t + self.dt * v, v])
        return self.observe(), -float(self.state @ self.state), False, {}


class GridWorld:
    ACTIONS = np.array([[0, 1], [0, -1], [1, 0], [-1, 0]])

    def __init__(self, size=7, seed=0, distractors=4):
        self.size, self.distractors = size, distractors
        self.rng = np.random.default_rng(seed)
        self.position = np.zeros(2, dtype=int)
        self.goal = np.array([size - 1, size - 1])

    def observe(self):
        return np.r_[
            self.position / (self.size - 1),
            self.goal / (self.size - 1),
            self.rng.normal(size=self.distractors),
        ]

    def reset(self):
        self.position[:] = 0
        return self.observe()

    def step(self, action):
        self.position = np.clip(
            self.position + self.ACTIONS[int(action)], 0, self.size - 1
        )
        done = bool(np.array_equal(self.position, self.goal))
        return self.observe(), 1.0 if done else -0.05, done, {}


def point_transitions(n=4096, seed=0, distractors=8):
    rng = np.random.default_rng(seed)
    state = rng.normal(size=(n, 4)).astype("float32")
    action = rng.uniform(-1, 1, (n, 2)).astype("float32")
    future = state.copy()
    future[:, 2:] = 0.9 * state[:, 2:] + 0.1 * action
    future[:, :2] += 0.1 * future[:, 2:]
    x = np.c_[state, rng.normal(size=(n, distractors))].astype("float32")
    y = np.c_[future, rng.normal(size=(n, distractors))].astype("float32")
    return x, action, y, state


class PointMass3D:
    """Minimal 3D virtual body with walls, gravity and bounded thrust.

    A research control environment, not a rendered graphics engine. Observation
    contains position, velocity, relative goal and independent sensor distractors.
    """

    def __init__(self, seed=0, dt=0.05, extent=3.0, distractors=4):
        if dt <= 0 or extent <= 0:
            raise ValueError("positive dt and extent required")
        self.rng = np.random.default_rng(seed)
        self.dt = dt
        self.extent = extent
        self.distractors = distractors
        self.state = np.zeros(6)
        self.goal = np.array([1.0, 1.0, 1.0])

    def observe(self):
        return np.r_[
            self.state,
            self.goal - self.state[:3],
            self.rng.normal(0, 0.05, self.distractors),
        ]

    def reset(self):
        self.state = np.r_[self.rng.uniform(-0.5, 0.5, 3), np.zeros(3)]
        return self.observe()

    def step(self, action):
        action = np.asarray(action, dtype=float)
        if action.shape != (3,) or not np.isfinite(action).all():
            raise ValueError("three finite actuator values required")
        acceleration = (
            3 * np.clip(action, -1, 1)
            - 0.2 * self.state[3:]
            + np.array([0.0, 0.0, -1.0])
        )
        self.state[3:] += self.dt * acceleration
        self.state[:3] += self.dt * self.state[3:]
        collided = np.abs(self.state[:3]) > self.extent
        self.state[:3] = np.clip(self.state[:3], -self.extent, self.extent)
        self.state[3:][collided] *= -0.5
        distance = float(np.linalg.norm(self.goal - self.state[:3]))
        done = distance < 0.1 and np.linalg.norm(self.state[3:]) < 0.2
        return (
            self.observe(),
            -distance - 0.01 * float(action @ action),
            bool(done),
            {"collision": bool(collided.any())},
        )


class DelayCompensatedController:
    """PD control with a constant-velocity forward prediction over actuator delay."""

    def __init__(self, kp=1.0, kd=0.5, delay=0.1):
        if delay < 0:
            raise ValueError("delay must be nonnegative")
        self.kp, self.kd, self.delay = kp, kd, delay

    def __call__(self, position, velocity, goal):
        prediction = np.asarray(position) + self.delay * np.asarray(velocity)
        return np.clip(
            self.kp * (np.asarray(goal) - prediction) - self.kd * np.asarray(velocity),
            -1,
            1,
        )
