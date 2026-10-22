"""Particle Life studio and explicitly bounded CPU reference models."""

import argparse
from dataclasses import asdict
from pathlib import Path

import numpy as np

from nova.bioma.determinism import canonical_json

COMMANDS = {"paint", "particle-life", "mpm", "spectral-render"}


def main(argv):
    parser = argparse.ArgumentParser(
        prog="nova cosm",
        description="Chromatic: actual Particle Life and layered liquid rendering",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("paint")
    p.add_argument(
        "--preset", choices=("ink", "life", "iridescent", "nebula"), default="ink"
    )
    p.add_argument("--count", type=int, default=8192)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument(
        "--quality", choices=("draft", "balanced", "high", "ultra"), default="balanced"
    )
    p.add_argument("--memory-mib", type=int, default=512)
    p.add_argument("--port", type=int, default=8768)
    p.add_argument(
        "--output", help="export self-contained HTML without starting a server"
    )
    p.add_argument("--open-browser", action="store_true")
    p = sub.add_parser("particle-life")
    p.add_argument("--count", type=int, default=512)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--steps", type=int, default=100)
    p.add_argument("--output", default="runs/particle-life.npz")
    p = sub.add_parser("mpm")
    p.add_argument("--count", type=int, default=256)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--steps", type=int, default=32)
    p.add_argument("--material", choices=("liquid", "stvk"), default="liquid")
    p.add_argument("--output", default="runs/mpm.npz")
    p = sub.add_parser("spectral-render")
    p.add_argument("--width", type=int, default=128)
    p.add_argument("--height", type=int, default=96)
    p.add_argument("--samples", type=int, default=16)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--output", default="runs/spectral.png")
    args = parser.parse_args(argv)
    if args.command == "paint":
        from nova.visuals.cinematic import CinematicConfig, export, serve

        config = CinematicConfig(
            args.preset, args.count, args.seed, args.quality, args.memory_mib
        )
        if args.output:
            result = export(config, args.output)
        else:
            serve(config, port=args.port, open_browser=args.open_browser)
            return
    elif args.command == "particle-life":
        from nova.matter.particle_life import ParticleLife, ParticleLifeConfig

        model = ParticleLife(ParticleLifeConfig(count=args.count, seed=args.seed))
        model.step(args.steps)
        result = {**model.save(args.output), "metrics": model.metrics()}
    elif args.command == "mpm":
        from nova.checkpoint import save_state
        from nova.matter.mpm import MaterialPointSystem, MPMConfig

        model = MaterialPointSystem(
            MPMConfig(particles=args.count, material=args.material, seed=args.seed)
        )
        model.step(args.steps)
        save_state(
            args.output,
            {
                "kind": "NOVA-MPM-REFERENCE-v1",
                "config": asdict(model.config),
                "position": model.x,
                "velocity": model.v,
                "affine": model.C,
                "deformation": model.F,
                "structure": model.structure,
                "metrics": model.metrics(),
            },
        )
        result = {
            "checkpoint": args.output,
            "metrics": model.metrics(),
            "scope": "CPU reference; not browser PBF or production FLIP/MPM",
        }
    else:
        from nova.optics.path_tracer import SpectralPathTracer
        from nova.visuals.renderer import write_png

        hdr, pixels = SpectralPathTracer(seed=args.seed).render(
            args.width, args.height, args.samples
        )
        write_png(args.output, pixels)
        np.savez_compressed(Path(args.output).with_suffix(".hdr.npz"), linear_rgb=hdr)
        result = {
            "image": args.output,
            "integrator": "bounded spectral unidirectional path tracing, HG, NEE/MIS",
            "samples": args.samples,
            "scene": "independent sphere calibration reference; not browser particles",
        }
    print(canonical_json(result).decode())
