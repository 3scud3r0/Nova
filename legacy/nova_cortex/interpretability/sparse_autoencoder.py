"""Overcomplete Top-K/L1 dictionary learning; sparse features are not semantic proofs."""

import torch
from torch import nn


class SparseAutoencoder(nn.Module):
    def __init__(
        self, latent_dim=1024, dictionary=16384, *, mode="topk", top_k=32, l1=0.01
    ):
        super().__init__()
        if not (
            1 <= top_k <= dictionary
            and latent_dim <= dictionary
            and latent_dim * dictionary <= 33_554_432
            and mode in {"topk", "l1"}
        ):
            raise ValueError("invalid sparse dictionary")
        self.latent_dim, self.dictionary = latent_dim, dictionary
        self.mode, self.top_k, self.l1 = mode, top_k, l1
        self.encoder = nn.Linear(latent_dim, dictionary)
        self.decoder = nn.Linear(dictionary, latent_dim, bias=False)
        self.b_dec = nn.Parameter(torch.zeros(latent_dim))
        nn.init.zeros_(self.encoder.bias)
        self.normalize_decoder()

    def encode(self, x):
        if x.shape[-1] != self.latent_dim:
            raise ValueError("latent width differs from SAE")
        features = torch.relu(self.encoder(x - self.b_dec))
        if self.mode == "topk":
            values, indices = features.topk(self.top_k, dim=-1)
            features = torch.zeros_like(features).scatter(-1, indices, values)
        return features

    def decode(self, features):
        return self.decoder(features) + self.b_dec

    def forward(self, x):
        features = self.encode(x)
        return self.decode(features), features

    def loss(self, x):
        reconstruction, features = self(x)
        mse = (reconstruction - x).square().mean()
        penalty = (
            self.l1 * features.abs().sum(-1).mean()
            if self.mode == "l1"
            else mse.new_zeros(())
        )
        return mse + penalty, dict(
            reconstruction=mse.detach(),
            sparsity_penalty=penalty.detach(),
            mean_active=(features > 0).sum(-1).float().mean().detach(),
        )

    @torch.no_grad()
    def normalize_decoder(self):
        self.decoder.weight.div_(
            self.decoder.weight.norm(dim=0, keepdim=True).clamp_min(1e-8)
        )

    @torch.no_grad()
    def project_decoder_gradient(self):
        gradient = self.decoder.weight.grad
        if gradient is not None:
            weight = self.decoder.weight
            gradient.sub_(weight * (weight * gradient).sum(0, keepdim=True))

    def ablate(self, latent, feature_id):
        if not 0 <= feature_id < self.dictionary:
            raise ValueError("invalid feature index")
        features = self.encode(latent)
        changed = features.clone()
        changed[..., feature_id] = 0
        # Preserve reconstruction residual so this changes only the selected direction.
        return latent + self.decode(changed) - self.decode(features)
