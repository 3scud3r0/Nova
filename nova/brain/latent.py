"""A stateful AdEx microcircuit that actually produces the runtime latent code."""

from __future__ import annotations
import numpy as np
from scipy import sparse
from nova.jepa.equilibrium import EquilibriumWorldModel, batch
from . import Microcircuit


class SpikingLatentEncoder:
    """Input currents -> E/PV/SST/VIP circuit -> spike/membrane latent readout.

    Readout combines windowed firing rate and subthreshold membrane evidence.
    Fixed afferent/readout coordinates; optional three-factor STDP changes only
    existing recurrent synapses, with Dale sign restored after every update.
    This model is not trained by EqProp and has no validated biological fit.
    """

    def __init__(
        self,
        inputs: int,
        latent_dim: int,
        *,
        units: int = 100,
        steps: int = 100,
        dt: float = 0.1,
        seed: int = 0,
        backend: str = "numpy",
    ):
        if (
            min(inputs, latent_dim, steps) < 1
            or units < max(20, latent_dim)
            or not 0 < dt <= 1
        ):
            raise ValueError("invalid spiking encoder dimensions/window")
        self.inputs, self.latent_dim, self.units, self.steps, self.dt = (
            inputs,
            latent_dim,
            units,
            steps,
            dt,
        )
        self.seed, self.backend = seed, backend
        self.circuit = Microcircuit(units, seed, backend)
        rng = np.random.default_rng(seed + 41)
        self.afferent = rng.normal(0, 1 / np.sqrt(inputs), (inputs, units))
        self.readout = np.linalg.qr(rng.normal(size=(units, latent_dim)))[0][
            :, :latent_dim
        ]
        self.pre_trace = np.zeros(units)
        self.post_trace = np.zeros(units)
        self.last_spikes = np.zeros(units, dtype=bool)
        self.last_diagnostics = {}

    def encode(self, inputs) -> np.ndarray:
        outputs = []
        for sample in batch(inputs, self.inputs):
            drive = 300 + 150 * np.tanh(sample @ self.afferent)
            counts = np.zeros(self.units)
            for _ in range(self.steps):
                spikes, _ = self.circuit.step(drive, self.dt)
                counts += spikes
                self.last_spikes = spikes
                self.pre_trace *= np.exp(-self.dt / 20)
                self.pre_trace += spikes
                self.post_trace *= np.exp(-self.dt / 25)
                self.post_trace += spikes
            rates = counts * 1000 / (self.steps * self.dt)
            evidence = 0.01 * rates + (self.circuit.neurons.v + 70) / 50
            outputs.append(np.tanh(evidence @ self.readout))
            self.last_diagnostics = {
                "mean_rate_hz": float(rates.mean()),
                "window_ms": self.steps * self.dt,
                "dale": self.circuit.check_dale(),
                "units": self.units,
            }
        return np.stack(outputs)

    def learn_local(self, modulator: float, lr: float = 0.001):
        if not np.isfinite(modulator) or lr < 0:
            raise ValueError("invalid local update")
        weights = self.circuit.weights.tocoo(copy=True)
        rows, cols = weights.row, weights.col
        eligibility = (
            self.pre_trace[rows] * self.last_spikes[cols]
            - self.last_spikes[rows] * self.post_trace[cols]
        )
        weights.data += lr * float(np.clip(modulator, -1, 1)) * eligibility
        excitatory = self.circuit.neurons.types[rows] == 0
        weights.data = np.where(
            excitatory, np.clip(weights.data, 0, 50), np.clip(weights.data, -50, 0)
        )
        self.circuit.weights = weights.tocsr()
        self._refresh_weights()

    def _refresh_weights(self):
        self.circuit.sst_weights = (
            sparse.diags((self.circuit.neurons.types == 2).astype(float))
            @ self.circuit.weights
        )
        self.circuit.somatic_weights = self.circuit.weights - self.circuit.sst_weights

    def state_dict(self) -> dict:
        w = self.circuit.weights
        return {
            "inputs": self.inputs,
            "latent_dim": self.latent_dim,
            "units": self.units,
            "steps": self.steps,
            "dt": self.dt,
            "seed": self.seed,
            "backend": self.backend,
            "afferent": self.afferent.copy(),
            "readout": self.readout.copy(),
            "trace": self.circuit.trace.copy(),
            "neurons": self.circuit.neurons.state_dict(),
            "weight_data": w.data.copy(),
            "weight_indices": w.indices.copy(),
            "weight_indptr": w.indptr.copy(),
            "pre_trace": self.pre_trace.copy(),
            "post_trace": self.post_trace.copy(),
            "last_spikes": self.last_spikes.copy(),
        }

    @classmethod
    def from_state_dict(cls, state):
        obj = cls(
            **{
                key: state[key]
                for key in (
                    "inputs",
                    "latent_dim",
                    "units",
                    "steps",
                    "dt",
                    "seed",
                    "backend",
                )
            }
        )
        for key in ("afferent", "readout", "pre_trace", "post_trace", "last_spikes"):
            setattr(obj, key, np.asarray(state[key]).copy())
        obj.circuit.trace = np.asarray(state["trace"]).copy()
        obj.circuit.neurons.load_state_dict(state["neurons"])
        obj.circuit.weights = sparse.csr_matrix(
            (state["weight_data"], state["weight_indices"], state["weight_indptr"]),
            shape=(obj.units, obj.units),
        )
        obj._refresh_weights()
        if not obj.circuit.check_dale():
            raise ValueError("checkpoint violates Dale sign constraint")
        return obj


class SpikingWorldModel(EquilibriumWorldModel):
    """N1 inference supplies z; the predictive world dynamics use nonlinear EqProp."""

    kind = "adex"

    def __init__(
        self,
        observation_dim,
        latent_dim,
        action_dim,
        *,
        seed=0,
        config=None,
        spiking_units=100,
        spiking_steps=100,
        spiking_backend="numpy",
    ):
        super().__init__(
            observation_dim, latent_dim, action_dim, seed=seed, config=config
        )
        self.spiking = SpikingLatentEncoder(
            observation_dim,
            latent_dim,
            units=max(spiking_units, latent_dim, 20),
            steps=spiking_steps,
            seed=seed,
            backend=spiking_backend,
        )

    def encode(self, x):
        result = self.spiking.encode(self._normalize(x))
        self.last_diagnostics = self.spiking.last_diagnostics.copy()
        return result

    def learn_transition(
        self, x, action, future, *, lr=0.01, train_encoder=False, **kwargs
    ):
        if train_encoder:
            raise ValueError(
                "AdEx supports explicit local STDP, not rate-network EqProp encoder training"
            )
        z = self.encode(x)
        state = self.spiking.state_dict()
        try:
            target = self.encode(future)
        finally:
            self.spiking = SpikingLatentEncoder.from_state_dict(state)
        return self.learn_latent(z, action, target, lr)

    def state_dict(self):
        return {**super().state_dict(), "spiking": self.spiking.state_dict()}

    @classmethod
    def from_state_dict(cls, state):
        from nova.jepa.equilibrium import EquilibriumConfig, EquilibriumNetwork

        sp = state["spiking"]
        obj = cls(
            state["observation_dim"],
            state["latent_dim"],
            state["action_dim"],
            config=EquilibriumConfig(**state["config"]),
            spiking_units=sp["units"],
            spiking_steps=sp["steps"],
            spiking_backend=sp["backend"],
        )
        for name in ("context", "target", "predictor"):
            setattr(obj, name, EquilibriumNetwork.from_state_dict(state[name]))
        obj.mean = np.asarray(state["mean"]).copy()
        obj.scale = np.asarray(state["scale"]).copy()
        obj.encoder_frozen = state["encoder_frozen"]
        obj.spiking = SpikingLatentEncoder.from_state_dict(sp)
        return obj
