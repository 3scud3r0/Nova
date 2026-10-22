"""Volumetric residual encoder plus permutation-invariant particle pooling."""

import torch
from torch import nn


class Residual3D(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Conv3d(channels, channels, 3, padding=1),
            nn.GroupNorm(4, channels),
            nn.SiLU(),
            nn.Conv3d(channels, channels, 3, padding=1),
            nn.GroupNorm(4, channels),
        )

    def forward(self, x):
        return torch.nn.functional.silu(x + self.layers(x))


class VisualRetina(nn.Module):
    def __init__(self, channels=4, embedding=512, max_voxels=2_097_152):
        super().__init__()
        self.channels, self.max_voxels = channels, max_voxels
        self.volume = nn.Sequential(
            nn.Conv3d(channels, 16, 3, stride=2, padding=1),
            nn.GroupNorm(4, 16),
            nn.SiLU(),
            Residual3D(16),
            nn.Conv3d(16, 32, 3, stride=2, padding=1),
            nn.GroupNorm(4, 32),
            nn.SiLU(),
            Residual3D(32),
        )
        self.particles = nn.Sequential(
            nn.Linear(8, 64), nn.SiLU(), nn.Linear(64, 64), nn.SiLU()
        )
        self.output = nn.Sequential(
            nn.Linear(32 * 2 + 64 * 2, embedding), nn.LayerNorm(embedding)
        )

    def forward(self, field_tensor, particle_tensor=None):
        if (
            field_tensor.ndim != 5
            or field_tensor.shape[1] != self.channels
            or field_tensor.numel() // field_tensor.shape[0]
            > self.channels * self.max_voxels
            or not torch.isfinite(field_tensor).all()
        ):
            raise ValueError("expected bounded finite [B,C,Z,Y,X] field")
        volume = self.volume(field_tensor)
        visual = torch.cat(
            [volume.mean(dim=(2, 3, 4)), volume.amax(dim=(2, 3, 4))], dim=-1
        )
        if particle_tensor is None:
            particle = visual.new_zeros((visual.shape[0], 128))
        else:
            if (
                particle_tensor.ndim != 3
                or particle_tensor.shape[0] != visual.shape[0]
                or particle_tensor.shape[-1] != 8
                or particle_tensor.shape[1] > 262144
                or not torch.isfinite(particle_tensor).all()
            ):
                raise ValueError("expected finite [B,N,8] particles")
            if particle_tensor.shape[1] == 0:
                particle = visual.new_zeros((visual.shape[0], 128))
            else:
                encoded = self.particles(particle_tensor)
                particle = torch.cat([encoded.mean(1), encoded.amax(1)], dim=-1)
        return self.output(torch.cat([visual, particle], dim=-1))

    encode = forward
