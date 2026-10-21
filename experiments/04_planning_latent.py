"""Memory/neuromod ablations and learned-model CEM vs offline DQN, shared transitions."""

import numpy as np
import torch
from torch import nn
from copy import deepcopy
from nova.memory import ModernHopfield, kwta
from nova.planning import LatentPlanner
from nova.neuromod import Neuromodulator
from experiments.common import write_report


def main():
    torch.set_num_threads(2)
    rows = []
    for seed in range(5):
        rng = np.random.default_rng(seed)
        torch.manual_seed(seed)
        patterns = kwta(rng.normal(size=(32, 256)), 0.05)
        patterns /= np.linalg.norm(patterns, axis=1, keepdims=True)
        h = ModernHopfield(patterns, 40)
        q = patterns + 0.3 * rng.normal(size=patterns.shape) / np.sqrt(256)
        masked = patterns * (rng.uniform(size=patterns.shape) > 0.5)
        noisy_acc = float(
            np.mean((h.retrieve(q) @ patterns.T).argmax(1) == np.arange(32))
        )
        masked_acc = float(
            np.mean((h.retrieve(masked) @ patterns.T).argmax(1) == np.arange(32))
        )
        # 2,048 identical one-step transitions available to both learned models.
        s = rng.uniform(-2, 2, (2048, 1))
        ai = rng.integers(0, 3, 2048)
        actions = np.array([-1.0, 0.0, 1.0])[ai, None]
        ns = s + 0.2 * actions
        rewards = -(ns[:, 0] ** 2)
        coef = np.linalg.lstsq(np.c_[s, actions, np.ones(len(s))], ns, rcond=None)[0]
        predictor = lambda z, a: np.c_[z, a, np.ones(len(z))] @ coef
        qnet = nn.Sequential(nn.Linear(1, 32), nn.Tanh(), nn.Linear(32, 3))
        target = deepcopy(qnet)
        opt = torch.optim.Adam(qnet.parameters(), lr=0.002)
        st = torch.tensor(s, dtype=torch.float32)
        nt = torch.tensor(ns, dtype=torch.float32)
        at = torch.tensor(ai)
        rt = torch.tensor(rewards, dtype=torch.float32)
        for i in range(800):
            idx = torch.randint(len(s), (128,))
            with torch.no_grad():
                value = rt[idx] + 0.95 * target(nt[idx]).max(1).values
            loss = (
                (qnet(st[idx]).gather(1, at[idx, None]).squeeze(1) - value)
                .square()
                .mean()
            )
            opt.zero_grad()
            loss.backward()
            opt.step()
            if i % 25 == 0:
                target.load_state_dict(qnet.state_dict())
        totals = {name: [] for name in ("cem", "random", "dqn")}
        for initial in (-1.5, -0.8, 0.8, 1.5):
            for name in totals:
                state = np.array([initial])
                total = 0.0
                planner = LatentPlanner(
                    predictor, lambda z: (z * z).sum(1), seed=seed, discount=0.95
                )
                for _ in range(15):
                    if name == "cem":
                        a = planner.plan(state).action
                    elif name == "random":
                        a = rng.uniform(-1, 1, 1)
                    else:
                        with torch.no_grad():
                            a = np.array(
                                [
                                    [-1.0, 0.0, 1.0][
                                        int(
                                            qnet(
                                                torch.tensor(state, dtype=torch.float32)
                                            ).argmax()
                                        )
                                    ]
                                ]
                            )
                    state = state + 0.2 * a
                    total -= float(state @ state)
                totals[name].append(total)
        # Each control signal is independently disabled; report its realized value.
        signals = {}
        for disabled in ("none", "NE", "DA", "ACh", "5HT"):
            mod = Neuromodulator(
                frozenset({"NE", "DA", "ACh", "5HT"} - {disabled})
            ).update(2.0, reward=1.0, uncertainty=0.7)
            signals[f"lr_without_{disabled}"] = mod.learning_rate(0.01)
            signals[f"consolidation_without_{disabled}"] = mod.consolidation()
            signals[f"sensory_without_{disabled}"] = mod.sensory_weight()
            signals[f"discount_without_{disabled}"] = mod.discount()
        rows.append(
            dict(
                seed=seed,
                recall_noise=noisy_acc,
                recall_mask=masked_acc,
                recall_chance=1 / 32,
                **{f"return_{k}": float(np.mean(v)) for k, v in totals.items()},
                **signals,
            )
        )
    write_report(
        4,
        rows,
        "Hopfield: 32 padrões, ruído 30% da norma e máscara Bernoulli 50%. CEM com modelo aprendido vs DQN offline e ações aleatórias, mesmas 2.048 transições, cinco sementes.",
        "CEM tem ações contínuas, DQN três ações discretas: não é equivalência de espaço de ações. Ablações dos neuromoduladores aqui verificam efeitos de controle, não ganho final em RL; permanecem opt-in. A cascata é um modelo de difusão declarado e validado analiticamente para M=2. Não se alega superioridade universal.",
    )


if __name__ == "__main__":
    main()
