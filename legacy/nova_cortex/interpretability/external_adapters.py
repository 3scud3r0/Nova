"""Optional adapters to external interpretability tools; no upstream source vendored."""

import torch


def train_saelens(activations, config, *, steps=100, learning_rate=1e-3, l1=0.01):
    """Use the installed SAELens API explicitly, returning its native SAE object.

    SAELens has evolving training APIs; the adapter requires the documented
    StandardSAE/StandardSAEConfig interface and fails explicitly when unavailable.
    """
    import sae_lens

    constructor = getattr(sae_lens, "StandardSAE", None)
    config_type = getattr(sae_lens, "StandardSAEConfig", None)
    if constructor is None or config_type is None:
        raise RuntimeError(
            "installed SAELens lacks StandardSAE/StandardSAEConfig; use the native Torch SAE or pin a compatible version"
        )
    cfg = config_type(**config)
    sae = constructor(cfg)
    if not callable(getattr(sae, "encode", None)) or not callable(
        getattr(sae, "decode", None)
    ):
        raise RuntimeError("incompatible SAELens encode/decode API")
    if (
        not 1 <= steps <= 10000
        or activations.numel() > 20_000_000
        or not 0 < learning_rate <= 0.01
        or l1 < 0
    ):
        raise ValueError("invalid SAELens training budget")
    sae = sae.to(activations.device)
    optimizer = torch.optim.Adam(sae.parameters(), lr=learning_rate)
    observations = activations.detach()
    for _ in range(steps):
        optimizer.zero_grad(set_to_none=True)
        features = sae.encode(observations)
        loss = (
            sae.decode(features) - observations
        ).square().mean() + l1 * features.abs().sum(-1).mean()
        if not torch.isfinite(loss):
            raise FloatingPointError("nonfinite SAELens objective")
        loss.backward()
        torch.nn.utils.clip_grad_norm_(sae.parameters(), 10, error_if_nonfinite=True)
        optimizer.step()
        if hasattr(sae, "W_dec"):
            with torch.no_grad():
                sae.W_dec.div_(sae.W_dec.norm(dim=1, keepdim=True).clamp_min(1e-8))
    return sae, sae.encode(observations).detach()


def transformer_activations(model, tokens, hook_name, *, max_elements=20_000_000):
    """Extract a named TransformerLens activation, without assuming NOVA is a transformer."""
    from transformer_lens import HookedTransformer

    if not isinstance(model, HookedTransformer):
        raise TypeError("a locally supplied TransformerLens model is required")
    with torch.no_grad():
        _, cache = model.run_with_cache(
            tokens, names_filter=lambda name: name == hook_name
        )
        activation = cache[hook_name]
    if activation.numel() > max_elements:
        raise ValueError("activation cache exceeds budget")
    return activation.detach()
