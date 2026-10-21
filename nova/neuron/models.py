from __future__ import annotations
import numpy as np
from scipy.special import expit
from nova.continual import ProtectedLinear
from nova.memory import kwta


class RateNeuron:
    """N0: y=ReLU(v_b*(1+tanh(v_a))); k-WTA after apical gain."""

    def __init__(self, inputs=8, units=32, seed=0, k=0.1, apical_gain=True):
        self.basal = ProtectedLinear(inputs, units, seed=seed)
        self.apical = ProtectedLinear(inputs, units, seed=seed + 1)
        self.k, self.apical_gain = k, apical_gain
        self.state = np.zeros(units)

    def step(self, inputs, modulators=None, dt=0.1):
        if dt <= 0:
            raise ValueError("dt must be positive")
        basal, apical = inputs
        vb = self.basal(np.asarray(basal)[None])[0]
        va = self.apical(np.asarray(apical)[None])[0]
        output = vb * (1 + np.tanh(va)) if self.apical_gain else vb + va
        self.state = kwta(np.maximum(output, 0), self.k)
        return self.state.copy(), {"rate": self.state.copy()}


class AdExPopulation:
    """N1, ms/mV/pA/pF: C dv/dt=-gL(v-EL)+gL*Delta*exp((v-VT)/Delta)-w+gc(d-v)+I.

    tau_w dw/dt=a(v-EL)-w; dendritic conductance coupling, optional NMDA sigmoid.
    Euler dt <= 1 ms. Types: 0=E, 1=PV, 2=SST, 3=VIP. Sign belongs to outgoing
    synapses and is enforced by Microcircuit. Parameters are research defaults.
    """

    def __init__(self, units=100, seed=0, backend="numpy", nmda=False):
        if units < 1:
            raise ValueError("units must be positive")
        rng = np.random.default_rng(seed)
        self.types = np.zeros(units, dtype=int)
        self.types[int(0.8 * units) : int(0.9 * units)] = 1
        self.types[int(0.9 * units) : int(0.95 * units)] = 2
        self.types[int(0.95 * units) :] = 3
        self.a = np.choose(self.types, [2.0, 0.0, 4.0, 2.0])
        self.b = np.choose(self.types, [40.0, 0.0, 80.0, 20.0])
        self.tau = np.choose(self.types, [200.0, 30.0, 250.0, 150.0]) * rng.lognormal(
            0, 0.1, units
        )
        self.v = np.full(units, -70.0)
        self.w = np.zeros(units)
        self.dendrite = self.v.copy()
        self.refractory = np.zeros(units)
        self.backend, self.nmda = backend, nmda

    def step(self, inputs, modulators=None, dt=0.1):
        if not 0 < dt <= 1:
            raise ValueError("N1 requires 0 < dt <= 1 ms")
        basal, apical = inputs
        basal = np.broadcast_to(np.asarray(basal, dtype=float), self.v.shape)
        apical = np.broadcast_to(np.asarray(apical, dtype=float), self.v.shape)
        if not np.isfinite(basal).all() or not np.isfinite(apical).all():
            raise ValueError("nonfinite currents")
        if self.backend == "rust":
            from nova.core import require_native

            args = [
                a.tolist()
                for a in (
                    self.v,
                    self.w,
                    self.dendrite,
                    self.refractory,
                    basal,
                    apical,
                    self.a,
                    self.b,
                    self.tau,
                )
            ]
            result = require_native().adex_step(*args, dt, self.nmda)
            self.v, self.w, self.dendrite, self.refractory, spikes = map(
                np.asarray, result
            )
        elif self.backend == "numpy":
            v, w, d = self.v, self.w, self.dendrite
            self.dendrite = (
                d
                + dt
                * (
                    -5 * (d + 70)
                    + 2 * (v - d)
                    + apical
                    + (30 * expit((d + 40) / 5) if self.nmda else 0)
                )
                / 100
            )
            self.w = w + dt * (self.a * (v + 70) - w) / self.tau
            updated = (
                v
                + dt
                * (
                    -10 * (v + 70)
                    + 20 * np.exp(np.minimum((v + 50) / 2, 10))
                    - w
                    + 2 * (d - v)
                    + basal
                )
                / 200
            )
            self.v = np.where(self.refractory > 0, -58.0, updated)
            self.refractory = np.maximum(self.refractory - dt, 0)
            spikes = self.v >= 20
            self.v[spikes] = -58
            self.w[spikes] += self.b[spikes]
            self.refractory[spikes] = 2
        else:
            raise ValueError("backend must be numpy or rust")
        return spikes.copy(), self.state_dict()

    def state_dict(self):
        return {
            key: getattr(self, key).copy()
            for key in ("v", "w", "dendrite", "refractory", "types", "a", "b", "tau")
        }

    def load_state_dict(self, state):
        for key, value in state.items():
            if key not in self.state_dict() or np.shape(value) != self.v.shape:
                raise ValueError("invalid neuron checkpoint")
            setattr(self, key, np.asarray(value).copy())


class HodgkinHuxleyCompartments:
    """N2 small branched cable: Na/K HH gates plus phenomenological Ca and Ih.

    C dV/dt=I-gNa*m³h(V-50)-gK*n⁴(V+77)-gCa*c²(V-120)-gh*q(V+20)
             -gL(V+54.4)+sum gc(V_neighbor-V). Gates relax to voltage equilibria.
    Explicit RK4, dt <= .05 ms; not a fitted cellular morphology.
    """

    def __init__(self, compartments=4):
        if compartments < 1:
            raise ValueError("compartments must be positive")
        self.v = np.full(compartments, -65.0)
        self.gates = self._steady(self.v)[0]
        self.coupling = np.zeros((compartments, compartments))
        for i in range(1, compartments):
            self.coupling[i, (i - 1) // 2] = self.coupling[(i - 1) // 2, i] = 0.1

    @staticmethod
    def _ratio(x):
        x = np.asarray(x)
        out = np.ones_like(x)
        np.divide(x, -np.expm1(-x), out=out, where=np.abs(x) > 1e-7)
        return out

    def _steady(self, v):
        am = self._ratio((v + 40) / 10)
        bm = 4 * np.exp(-(v + 65) / 18)
        ah = 0.07 * np.exp(-(v + 65) / 20)
        bh = expit((v + 35) / 10)
        an = 0.1 * self._ratio((v + 55) / 10)
        bn = 0.125 * np.exp(-(v + 65) / 80)
        steady = np.stack(
            (
                am / (am + bm),
                ah / (ah + bh),
                an / (an + bn),
                expit((v + 20) / 6),
                expit(-(v + 80) / 8),
            )
        )
        tau = np.stack(
            (
                1 / (am + bm),
                1 / (ah + bh),
                1 / (an + bn),
                np.full_like(v, 5),
                np.full_like(v, 100),
            )
        )
        return steady, tau

    def step(self, inputs, modulators=None, dt=0.01):
        if not 0 < dt <= 0.05:
            raise ValueError("N2 requires 0 < dt <= .05 ms")
        basal, apical = inputs
        current = np.broadcast_to(np.asarray(basal, dtype=float), self.v.shape).copy()
        current[1:] += np.broadcast_to(np.asarray(apical, dtype=float), self.v.shape)[
            1:
        ]
        before = self.v.copy()
        state = np.vstack((self.v, self.gates))

        def f(s):
            v = s[0]
            m, h, n, c, q = s[1:]
            steady, tau = self._steady(v)
            ionic = (
                120 * m**3 * h * (v - 50)
                + 36 * n**4 * (v + 77)
                + 0.05 * c * c * (v - 120)
                + 0.02 * q * (v + 20)
                + 0.3 * (v + 54.4)
            )
            dv = current - ionic + self.coupling @ v - self.coupling.sum(1) * v
            return np.vstack((dv, (steady - s[1:]) / tau))

        k1 = f(state)
        k2 = f(state + dt * k1 / 2)
        k3 = f(state + dt * k2 / 2)
        k4 = f(state + dt * k3)
        state += dt * (k1 + 2 * k2 + 2 * k3 + k4) / 6
        self.v, self.gates = state[0], state[1:]
        return (before < 0) & (self.v >= 0), {
            "v": self.v.copy(),
            "gates": self.gates.copy(),
        }


def make_neuron(level="N0", **kwargs):
    return {"N0": RateNeuron, "N1": AdExPopulation, "N2": HodgkinHuxleyCompartments}[
        level
    ](**kwargs)
