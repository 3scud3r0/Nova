"""Modality encoders, streaming log-mel audio, slots and predictive inference."""

from __future__ import annotations
import math
import numpy as np
import torch
from torch import nn
from torch.nn import functional as F


class VisionEncoder(nn.Module):
    def __init__(self, latent_dim=16, channels=3):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(channels, 16, 3, padding=1),
            nn.SiLU(),
            nn.Conv2d(16, 32, 3, stride=2, padding=1),
            nn.SiLU(),
            nn.AdaptiveAvgPool2d(1),
            nn.Flatten(),
            nn.Linear(32, latent_dim),
        )

    def foveate(self, image, gaze=(0.0, 0.0), radius=0.3):
        if radius <= 0:
            raise ValueError("radius must be positive")
        h, w = image.shape[-2:]
        yy, xx = torch.meshgrid(
            torch.linspace(-1, 1, h, device=image.device),
            torch.linspace(-1, 1, w, device=image.device),
            indexing="ij",
        )
        mask = torch.exp(-((xx - gaze[0]) ** 2 + (yy - gaze[1]) ** 2) / (2 * radius**2))
        low = F.interpolate(
            F.interpolate(image, size=(max(1, h // 8), max(1, w // 8)), mode="area"),
            size=(h, w),
            mode="bilinear",
            align_corners=False,
        )
        return image * mask + low * (1 - mask)

    def forward(self, image, gaze=(0.0, 0.0)):
        return self.net(self.foveate(image, gaze))


def mel_filters(sample_rate, n_fft, bands):
    hz_to_mel = lambda hz: 2595 * math.log10(1 + hz / 700)
    points = 700 * (
        10 ** (torch.linspace(0, hz_to_mel(sample_rate / 2), bands + 2) / 2595) - 1
    )
    freq = torch.linspace(0, sample_rate / 2, n_fft // 2 + 1)
    rising = (freq[None] - points[:-2, None]) / (points[1:-1, None] - points[:-2, None])
    falling = (points[2:, None] - freq[None]) / (points[2:, None] - points[1:-1, None])
    return torch.minimum(rising, falling).clamp_min(0)


class StreamingAudioEncoder(nn.Module):
    """Uncentered STFT -> log-mel -> causal temporal convolution; chunk-invariant."""

    def __init__(self, latent_dim=16, sample_rate=16000, n_fft=256, hop=128, bands=24):
        super().__init__()
        if not 0 < hop <= n_fft:
            raise ValueError("hop must be in (0,n_fft]")
        self.n_fft, self.hop, self.bands = n_fft, hop, bands
        self.register_buffer("filters", mel_filters(sample_rate, n_fft, bands))
        self.register_buffer("window", torch.hann_window(n_fft))
        self.register_buffer("samples", torch.empty(0))
        self.register_buffer("history", torch.zeros(1, bands, 2))
        self.conv = nn.Conv1d(bands, latent_dim, 3)

    def reset(self):
        self.samples = self.samples.new_empty(0)
        self.history.zero_()

    def forward(self, chunk):
        if chunk.ndim != 1:
            raise ValueError("expected mono one-dimensional samples")
        samples = torch.cat((self.samples, chunk))
        if len(samples) < self.n_fft:
            self.samples = samples.detach()
            return samples.new_empty((0, self.conv.out_channels))
        frames = samples.unfold(0, self.n_fft, self.hop)
        spectrum = torch.fft.rfft(frames * self.window).abs().square()
        mel = torch.log1p(spectrum @ self.filters.T).T[None]
        sequence = torch.cat((self.history, mel), dim=2)
        output = self.conv(sequence).squeeze(0).T
        self.history = sequence[:, :, -2:].detach()
        self.samples = samples[len(frames) * self.hop :].detach()
        return output


class TextEncoder(nn.Module):
    """UTF-8 byte tokens (padding=256) and a small recurrent sensory encoder."""

    def __init__(self, latent_dim=16):
        super().__init__()
        self.embedding = nn.Embedding(257, 32, padding_idx=256)
        self.gru = nn.GRU(32, latent_dim, batch_first=True)

    def forward(self, texts):
        encoded = [list(t.encode("utf-8")) or [256] for t in texts]
        if not encoded:
            raise ValueError("empty batch")
        lengths = torch.tensor([len(t) for t in encoded])
        tokens = torch.full(
            (len(encoded), int(lengths.max())),
            256,
            dtype=torch.long,
            device=self.embedding.weight.device,
        )
        for i, tokens_i in enumerate(encoded):
            tokens[i, : len(tokens_i)] = torch.tensor(tokens_i, device=tokens.device)
        packed = nn.utils.rnn.pack_padded_sequence(
            self.embedding(tokens), lengths, batch_first=True, enforce_sorted=False
        )
        _, state = self.gru(packed)
        return state[-1]


class SlotAttention(nn.Module):
    """Iterative slot competition; previous slots provide temporal object context."""

    def __init__(self, dimension=16, slots=4, iterations=3):
        super().__init__()
        self.initial = nn.Parameter(torch.randn(1, slots, dimension) * 0.1)
        self.key = nn.Linear(dimension, dimension)
        self.query = nn.Linear(dimension, dimension)
        self.value = nn.Linear(dimension, dimension)
        self.update = nn.GRUCell(dimension, dimension)
        self.iterations = iterations

    def forward(self, tokens, previous=None):
        slots = (
            self.initial.expand(len(tokens), -1, -1) if previous is None else previous
        )
        k, v = self.key(tokens), self.value(tokens)
        for _ in range(self.iterations):
            score = (
                self.query(slots) @ k.transpose(-1, -2) / math.sqrt(tokens.shape[-1])
            )
            attention = score.softmax(dim=1) + 1e-8
            attention = attention / attention.sum(-1, keepdim=True)
            updates = attention @ v
            slots = self.update(
                updates.reshape(-1, tokens.shape[-1]),
                slots.reshape(-1, tokens.shape[-1]),
            ).reshape_as(slots)
        return slots


class MultimodalFusion(nn.Module):
    def __init__(self, dimension=16):
        super().__init__()
        self.cross = nn.Linear(dimension, dimension, bias=False)

    def cross_prediction_loss(self, a, b):
        return F.smooth_l1_loss(self.cross(a), b.detach()) + F.smooth_l1_loss(
            self.cross(b), a.detach()
        )

    def forward(self, modalities, precision=None):
        stack = torch.stack(modalities, dim=1)
        weights = (
            torch.ones(stack.shape[:2], device=stack.device)
            if precision is None
            else precision
        )
        if torch.any(weights < 0) or torch.any(weights.sum(1) <= 0):
            raise ValueError("precision must be nonnegative with positive sum")
        return (stack * weights[:, :, None]).sum(1) / weights.sum(1, keepdim=True)


class PredictiveHierarchy:
    """E=1/2 sum_l pi_l ||r_l-W_l r_(l+1)||²; relax representations by gradient descent."""

    def __init__(self, dimensions=(8, 4, 2), seed=0):
        rng = np.random.default_rng(seed)
        self.weights = [
            rng.normal(0, 1 / np.sqrt(b), (a, b))
            for a, b in zip(dimensions[:-1], dimensions[1:])
        ]
        self.dimensions = dimensions

    def infer(self, observation, precision=None, steps=100, lr=0.03):
        x = np.asarray(observation, dtype=float)
        states = [x.copy()] + [
            np.zeros((*x.shape[:-1], d)) for d in self.dimensions[1:]
        ]
        precision = [1.0] * len(self.weights) if precision is None else precision
        if len(precision) != len(self.weights) or any(
            np.any(np.asarray(p) < 0) for p in precision
        ):
            raise ValueError("invalid precision")
        history = []
        for _ in range(steps):
            errors = [
                states[i] - states[i + 1] @ w.T for i, w in enumerate(self.weights)
            ]
            history.append(
                float(
                    sum(
                        np.sum(np.asarray(p) * e * e) / 2
                        for p, e in zip(precision, errors)
                    )
                )
            )
            gradients = []
            for i in range(1, len(states)):
                grad = -(errors[i - 1] * precision[i - 1]) @ self.weights[i - 1]
                if i < len(errors):
                    grad += errors[i] * precision[i]
                gradients.append(grad)
            for i, grad in enumerate(gradients, 1):
                states[i] -= lr * grad
        return states, history

    def learn(self, states, lr=0.001):
        for i, w in enumerate(self.weights):
            error = states[i] - states[i + 1] @ w.T
            w += (
                lr
                * np.atleast_2d(error).T
                @ np.atleast_2d(states[i + 1])
                / len(np.atleast_2d(error))
            )
