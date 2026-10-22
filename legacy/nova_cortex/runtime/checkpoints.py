"""Local tensor-only checkpoints with explicit architecture and representation IDs."""

from pathlib import Path
import hashlib
import os
import torch


def fingerprint(module):
    digest = hashlib.sha256()
    for name, tensor in sorted(module.state_dict().items()):
        digest.update(name.encode())
        digest.update(str(tuple(tensor.shape)).encode())
        digest.update(tensor.detach().cpu().contiguous().numpy().tobytes())
    return digest.hexdigest()


def save(path, payload):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(f".{os.getpid()}.tmp")
    try:
        with temporary.open("xb") as file:
            torch.save(payload, file)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def load(path, *, max_bytes=2 * 1024**3):
    path = Path(path)
    if not 0 < path.stat().st_size <= max_bytes:
        raise ValueError("checkpoint exceeds byte budget")
    payload = torch.load(path, map_location="cpu", weights_only=True)
    if not isinstance(payload, dict) or payload.get("schema") not in {
        "NOVA-CORTEX-v1",
        "NOVA-SAE-v1",
    }:
        raise ValueError("unsupported tensor checkpoint")
    return payload


def dictionary_namespace(representation, sae):
    import json

    description = dict(
        representation=representation,
        weights=fingerprint(sae),
        mode=sae.mode,
        top_k=sae.top_k,
        latent_dim=sae.latent_dim,
        dictionary=sae.dictionary,
    )
    return hashlib.sha256(json.dumps(description, sort_keys=True).encode()).hexdigest()


def representation_fingerprint(retina, world, normalizer):
    import json

    payload = dict(
        retina=fingerprint(retina),
        world=fingerprint(world),
        proprioception=normalizer.state_dict(),
    )
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, allow_nan=False).encode()
    ).hexdigest()
