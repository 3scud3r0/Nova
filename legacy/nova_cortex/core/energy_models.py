"""Optional Hamiltonian and Lagrangian dynamical parameterizations."""

import torch
from torch import nn


class HamiltonianNetwork(nn.Module):
    def __init__(self, dimensions, hidden=128):
        super().__init__()
        if dimensions < 2 or dimensions % 2:
            raise ValueError("canonical phase space requires equal q/p dimensions")
        self.dimensions = dimensions
        self.energy = nn.Sequential(
            nn.Linear(dimensions, hidden),
            nn.Tanh(),
            nn.Linear(hidden, hidden),
            nn.Tanh(),
            nn.Linear(hidden, 1),
        )

    def vector_field(self, state, *, create_graph=True):
        with torch.enable_grad():
            state = state.requires_grad_(True)
            gradient = torch.autograd.grad(
                self.energy(state).sum(), state, create_graph=create_graph
            )[0]
            q, p = gradient.chunk(2, -1)
            return torch.cat([p, -q], -1)

    def loss(self, state, derivative):
        return torch.nn.functional.mse_loss(self.vector_field(state), derivative)


class LagrangianNetwork(nn.Module):
    def __init__(self, coordinates, hidden=128, ridge=1e-4):
        super().__init__()
        if not 1 <= coordinates <= 16 or ridge <= 0:
            raise ValueError("invalid Lagrangian dimensions/regularization")
        self.coordinates, self.ridge = coordinates, ridge
        self.lagrangian = nn.Sequential(
            nn.Linear(2 * coordinates, hidden), nn.Softplus(), nn.Linear(hidden, 1)
        )

    def acceleration(self, q, velocity):
        if q.ndim != 1 or q.shape != velocity.shape or q.numel() != self.coordinates:
            raise ValueError("acceleration expects one q/v sample")
        state = torch.cat([q, velocity]).requires_grad_(True)
        scalar = lambda x: self.lagrangian(x).squeeze()
        gradient = torch.autograd.functional.jacobian(scalar, state, create_graph=True)
        hessian = torch.autograd.functional.hessian(scalar, state, create_graph=True)
        n = self.coordinates
        mass = hessian[n:, n:] + self.ridge * torch.eye(n, device=q.device)
        # Ridge regularization changes the Euler-Lagrange equation near singularity.
        return torch.linalg.solve(mass, gradient[:n] - hessian[n:, :n] @ velocity)

    def loss(self, q, velocity, acceleration):
        if q.ndim != 2 or q.shape != velocity.shape or q.shape != acceleration.shape:
            raise ValueError("LNN loss requires matching [B,D] tensors")
        predicted = torch.stack([self.acceleration(a, b) for a, b in zip(q, velocity)])
        return torch.nn.functional.mse_loss(predicted, acceleration)
