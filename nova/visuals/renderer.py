"""Bounded volume rendering; appearance is illustrative, not a light solver."""

from __future__ import annotations
import base64
import json
from pathlib import Path
import struct
import zlib
import numpy as np


def write_png(path, rgb):
    pixels = np.asarray(rgb, dtype=np.uint8)
    if pixels.ndim != 3 or pixels.shape[2] != 3:
        raise ValueError("RGB image required")
    h, w, _ = pixels.shape

    def chunk(kind, data):
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    raw = b"".join(b"\0" + row.tobytes() for row in pixels)
    data = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


class FieldRenderer:
    @staticmethod
    def density(ecosystem):
        world = ecosystem.world
        mode = world.config.mode
        if mode == "conway":
            field = world.life.astype(float)
        elif mode == "wave":
            field = np.clip(np.abs(world.wave), 0, 1)
        elif mode == "nca":
            field = np.clip(world.channels[0], 0, 1)
        elif mode == "particles":
            field = np.zeros(world.shape)
            coords = np.floor(world.particle_positions).astype(int) % np.asarray(
                world.shape
            )
            np.add.at(field, tuple(coords.T), 1.0)
            field = np.clip(field, 0, 1)
        else:
            field = np.clip(world.v * 3, 0, 1)
        field = field.copy()
        # Developed occupancy follows the organism's point body; no mesh or
        # resolved soft-body mechanics is implied by the rendered appearance.
        for organism in ecosystem.organisms:
            body = organism.body["density"]
            indices = np.argwhere(body > 0.1)
            if len(indices):
                offsets = (indices / body.shape[0] - 0.5) * 4
                positions = np.floor(
                    organism.position + offsets[:, : world.ndim]
                ).astype(int) % np.asarray(world.shape)
                np.maximum.at(
                    field,
                    tuple(positions.T),
                    np.minimum(1.0, body[tuple(indices.T)] + 0.25),
                )
        if field.ndim == 2:
            field = np.repeat(field[None], 4, axis=0)
        return np.ascontiguousarray(field, dtype=float)

    @classmethod
    def frame(cls, ecosystem):
        density = cls.density(ecosystem)
        image = np.rint(density * 255).astype(np.uint8)
        topology = (
            ecosystem.organisms[0].genome.develop_brain()
            if ecosystem.organisms
            else None
        )
        return {
            "shape": list(image.shape),
            "volume": base64.b64encode(image.tobytes()).decode(),
            "metrics": ecosystem.metrics(),
            "communications": ecosystem.interpreter.report()
            if hasattr(ecosystem, "interpreter")
            else None,
            "mode": ecosystem.world.config.mode,
            "architecture": None
            if topology is None
            else {
                "coordinates": topology["coordinates"].tolist(),
                "types": topology["types"].tolist(),
                "families": topology["families"].tolist(),
                "edges": [
                    [int(i), int(j), float(topology["weights"][i, j])]
                    for i, j in zip(*np.nonzero(topology["weights"]))
                ],
            },
        }

    @classmethod
    def render(cls, ecosystem, output, *, kind="volume", resolution=384):
        if not 32 <= resolution <= 1024:
            raise ValueError("image resolution out of bounds")
        density = cls.density(ecosystem)
        if kind == "slice":
            scalar = density[len(density) // 2]
            rgb = np.stack((scalar, np.sqrt(scalar) * 0.7, 1 - scalar), -1)
        elif kind == "volume":
            h, w = density.shape[1:]
            transmission = np.ones((h, w))
            rgb = np.zeros((h, w, 3))
            gradient = np.gradient(density)
            normal = np.sqrt(sum(g * g for g in gradient)) + 1e-8
            for z in range(len(density)):
                d = density[z]
                alpha = 1 - np.exp(-d * 6 / len(density))
                light = 0.25 + 0.75 * np.abs(gradient[0][z]) / normal[z]
                color = (
                    np.stack((0.15 + 0.8 * d, 0.35 + 0.6 * d, 0.8 - 0.35 * d), -1)
                    * light[..., None]
                )
                rgb += transmission[..., None] * alpha[..., None] * color
                transmission *= 1 - alpha
            rgb += transmission[..., None] * np.array([0.015, 0.025, 0.06])
        else:
            raise ValueError("unknown renderer")
        y = np.linspace(0, rgb.shape[0] - 1, resolution).astype(int)
        x = np.linspace(0, rgb.shape[1] - 1, resolution).astype(int)
        write_png(
            output,
            np.rint(np.clip(rgb[y[:, None], x[None, :]], 0, 1) * 255).astype(np.uint8),
        )
        return {"image": str(output), "renderer": kind, "physical_radiometry": False}

    @classmethod
    def export_html(cls, ecosystem, path):
        template = Path(__file__).with_name("viewer.html").read_text()
        frame = json.dumps(cls.frame(ecosystem), allow_nan=False).replace(
            "<", "\\u003c"
        )
        html = template.replace("/*INITIAL_FRAME*/null", frame).replace(
            "/*LIVE_CONFIG*/null", "null"
        )
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(html)
        return {"viewer": str(target), "offline": True}
