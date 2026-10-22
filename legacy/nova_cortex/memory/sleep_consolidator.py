"""Offline replay while lockstep IPC leaves the simulator waiting for an action."""

import torch


class SleepConsolidator:
    def __init__(self, config):
        self.config = config
        self.recent = []
        self.cycles = 0

    def needs_consolidation(self, tick, loss):
        self.recent.append(float(loss))
        self.recent = self.recent[-self.config.stagnation_window :]
        scheduled = (
            self.config.sleep_every > 0
            and tick > 0
            and tick % self.config.sleep_every == 0
        )
        stagnant = (
            len(self.recent) == self.config.stagnation_window
            and max(self.recent) - min(self.recent) < 1e-5
        )
        return scheduled or stagnant

    def run(self, buffer, update, *, model=None):
        if not len(buffer):
            return dict(cycle=self.cycles, updates=0)
        self.cycles += 1
        losses = []
        # Replay high-surprise episodes first, then PER; no claimed 50x speed.
        protected = buffer.most_surprising(
            min(1000, self.config.batch_size * self.config.sleep_updates)
        )
        for iteration in range(self.config.sleep_updates):
            if iteration == 0 and protected:
                records = protected[: self.config.batch_size]
                losses.append(float(update(records, None, None)))
            else:
                records, indices, weights = buffer.sample(self.config.batch_size)
                losses.append(float(update(records, indices, weights)))
        if model is not None:
            basis = None
            if protected:
                parameter = next(model.parameters())
                matrix = torch.as_tensor(
                    __import__("numpy").stack([t.previous_h for t in protected[:32]]),
                    dtype=parameter.dtype,
                    device=parameter.device,
                ).T
                with torch.no_grad():
                    u, singular, _ = torch.linalg.svd(matrix, full_matrices=False)
                    rank = min(
                        int((singular > 1e-6).sum()), 32, max(1, matrix.shape[0] // 4)
                    )
                    if rank:
                        basis = u[:, :rank]
            self.regularize(model, protected_basis=basis)
        self.recent.clear()
        return dict(
            cycle=self.cycles,
            updates=len(losses),
            mean_loss=sum(losses) / max(1, len(losses)),
        )

    @staticmethod
    @torch.no_grad()
    def regularize(model, decay=1e-5, protected_basis=None):
        # If supplied, basis columns span protected input directions. Decay only
        # their orthogonal complement. No guarantee of catastrophic-forgetting immunity.
        for parameter in model.parameters():
            if parameter.ndim != 2:
                continue
            if (
                protected_basis is not None
                and parameter.shape[1] == protected_basis.shape[0]
            ):
                basis = torch.linalg.qr(protected_basis, mode="reduced").Q
                parameter.sub_(decay * (parameter - parameter @ basis @ basis.T))
            else:
                parameter.mul_(1 - decay)
