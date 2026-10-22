"""Delayed finite-bandwidth acoustic packets with range/attenuation, not full acoustics."""

from dataclasses import dataclass, asdict
from copy import deepcopy
import numpy as np


@dataclass(frozen=True)
class AcousticConfig:
    vocabulary: int = 8
    speed: float = 4.0
    max_range: float = 12.0
    decay: float = 0.08
    max_pending: int = 2048
    max_delivered: int = 4096
    emission_period: int = 4

    def __post_init__(self):
        if (
            not 2 <= self.vocabulary <= 32
            or not 0.01 <= self.speed <= 100
            or not 0 < self.max_range <= 128
            or not 0 <= self.decay <= 1
            or not 1 <= self.max_pending <= 8192
            or not 1 <= self.emission_period <= 100
        ):
            raise ValueError("acoustic budget exceeded")


class AcousticChannel:
    def __init__(self, shape, config=None):
        self.shape = np.asarray(shape, dtype=float)
        self.config = config or AcousticConfig()
        self.pending = []
        self.log = []
        self.last_emit = {}
        self.spent = 0.0

    def emit(self, sender, position, token, recipients, tick):
        c = self.config
        if not isinstance(token, int) or not 0 <= token < c.vocabulary:
            raise ValueError("unknown acoustic token")
        if tick - self.last_emit.get(sender, -c.emission_period) < c.emission_period:
            return 0.0
        self.last_emit[sender] = tick
        self.spent += 0.001
        for receiver, location in sorted(recipients, key=lambda x: x[0]):
            if receiver == sender:
                continue
            delta = np.abs(np.asarray(location) - position)
            distance = float(np.linalg.norm(np.minimum(delta, self.shape - delta)))
            if distance > c.max_range or len(self.pending) >= c.max_pending:
                continue
            self.pending.append(
                {
                    "sender": sender,
                    "receiver": receiver,
                    "token": token,
                    "arrival": tick + max(1, int(np.ceil(distance / c.speed))),
                    "emitted": tick,
                    "amplitude": float(np.exp(-c.decay * distance)),
                }
            )
        return 0.001

    def receive(self, tick, alive):
        delivered = [
            p
            for p in self.pending
            if p["arrival"] <= tick and p["receiver"] in alive and p["sender"] in alive
        ]
        self.pending = [
            p
            for p in self.pending
            if p["arrival"] > tick and p["receiver"] in alive and p["sender"] in alive
        ]
        self.last_emit = {k: v for k, v in self.last_emit.items() if k in alive}
        self.log = (self.log + delivered)[-self.config.max_delivered :]
        return delivered

    def state_dict(self):
        return {
            "shape": self.shape.tolist(),
            "config": asdict(self.config),
            "pending": deepcopy(self.pending),
            "log": deepcopy(self.log),
            "last_emit": deepcopy(self.last_emit),
            "spent": self.spent,
        }

    @classmethod
    def restore(cls, state):
        obj = cls(state["shape"], AcousticConfig(**state["config"]))
        for key in ("pending", "log", "last_emit", "spent"):
            setattr(obj, key, deepcopy(state[key]))
        if (
            len(obj.pending) > obj.config.max_pending
            or len(obj.log) > obj.config.max_delivered
        ):
            raise ValueError("acoustic state exceeds budget")
        return obj


class CochlearBank:
    """Streaming digital band-pass bank with filter state and RMS energies.

    This transducer is available for sampled audio experiments; the ecosystem's
    packet channel remains an abstract delayed/attenuated signaling medium.
    """

    def __init__(self, sample_rate=8000, bands=8):
        from scipy.signal import butter

        if not 2000 <= sample_rate <= 48000 or not 2 <= bands <= 32:
            raise ValueError("cochlear filter budget exceeded")
        self.sample_rate = sample_rate
        self.edges = np.geomspace(80, sample_rate * 0.45, bands + 1)
        self.filters = [
            butter(2, [lo, hi], btype="bandpass", fs=sample_rate, output="sos")
            for lo, hi in zip(self.edges[:-1], self.edges[1:])
        ]
        self.state = [np.zeros((len(sos), 2)) for sos in self.filters]

    def process(self, samples):
        from scipy.signal import sosfilt

        samples = np.asarray(samples, dtype=float)
        if (
            samples.ndim != 1
            or not 1 <= len(samples) <= 65536
            or not np.isfinite(samples).all()
        ):
            raise ValueError("audio frame budget exceeded")
        energies = []
        for index, sos in enumerate(self.filters):
            filtered, self.state[index] = sosfilt(sos, samples, zi=self.state[index])
            energies.append(float(np.mean(filtered**2)))
        return np.asarray(energies)


def image_source_echoes(source, receiver, box, speed=343.0, reflection=0.5):
    """Direct path and first-order wall images in a rectangular reflective box.

    Separate from the periodic simulation boundary; returns impulse delays/gains,
    not a full diffraction or reverberation solution.
    """
    source, receiver, box = map(
        lambda x: np.asarray(x, dtype=float), (source, receiver, box)
    )
    if (
        source.shape != receiver.shape
        or source.shape != box.shape
        or source.ndim != 1
        or not len(box) in (2, 3)
        or not all(np.isfinite(x).all() for x in (source, receiver, box))
        or np.any(box <= 0)
        or np.any(source < 0)
        or np.any(receiver < 0)
        or np.any(source > box)
        or np.any(receiver > box)
        or not np.isfinite(speed)
        or speed <= 0
        or not 0 <= reflection <= 1
    ):
        raise ValueError("invalid reflective acoustic domain")
    paths = [(source, 1.0)]
    for axis, length in enumerate(box):
        for value in (-source[axis], 2 * length - source[axis]):
            image = source.copy()
            image[axis] = value
            paths.append((image, reflection))
    return [
        {
            "delay_seconds": float(np.linalg.norm(image - receiver) / speed),
            "gain": float(gain / (1 + np.linalg.norm(image - receiver))),
        }
        for image, gain in paths
    ]
