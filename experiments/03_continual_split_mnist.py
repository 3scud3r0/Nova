"""Class-incremental MNIST: no task oracle; full data with --samples 0."""

import argparse
import csv
from pathlib import Path
from experiments.refresh_reports import parse
from copy import deepcopy
import numpy as np
import torch
from torch.nn import functional as F
from torchvision.datasets import MNIST, CIFAR100
from nova.continual.deep import (
    MLP,
    OnlineEWC,
    LayerwiseGPM,
    FrozenProtectedClassifier,
    continual_metrics,
)
from nova.continual import linear_cka
from experiments.common import write_report, paired


def data_tasks(dataset, samples, seed):
    gen = torch.Generator().manual_seed(seed)
    if dataset == "split-cifar100":
        train = CIFAR100("data", train=True, download=True)
        test = CIFAR100("data", train=False, download=True)
        x = torch.tensor(train.data).float().flatten(1) / 255
        tx = torch.tensor(test.data).float().flatten(1) / 255
        y = torch.tensor(train.targets)
        ty = torch.tensor(test.targets)
        groups = [range(i, i + 10) for i in range(0, 100, 10)]
    else:
        MNIST.mirrors = ["https://raw.githubusercontent.com/fgnt/mnist/master/"]
        train = MNIST("data", train=True, download=True)
        test = MNIST("data", train=False, download=True)
        x = train.data.flatten(1).float() / 255
        tx = test.data.flatten(1).float() / 255
        y = train.targets
        ty = test.targets
        groups = [range(i, i + 2) for i in range(0, 10, 2)]
    tasks = []
    if dataset == "permuted-mnist":
        groups = [range(10)] * 5
    for group in groups:
        idx = torch.where(torch.isin(y, torch.tensor(list(group))))[0]
        idx = idx[torch.randperm(len(idx), generator=gen)]
        if samples:
            idx = idx[:samples]
        tidx = torch.where(torch.isin(ty, torch.tensor(list(group))))[0]
        perm = (
            torch.randperm(x.shape[1], generator=gen)
            if dataset == "permuted-mnist"
            else torch.arange(x.shape[1])
        )
        tasks.append((x[idx][:, perm], y[idx], tx[tidx][:, perm], ty[tidx]))
    return tasks, int(y.max() + 1)


def train(model, x, y, epochs, generator, ewc=None, gpm=None):
    optimizer = torch.optim.SGD(model.parameters(), lr=0.08)
    for _ in range(epochs):
        for idx in torch.randperm(len(x), generator=generator).split(128):
            loss = F.cross_entropy(model(x[idx]), y[idx])
            if ewc:
                loss = loss + ewc.penalty(model)
            optimizer.zero_grad()
            loss.backward()
            if gpm:
                gpm.project(model)
            optimizer.step()


@torch.no_grad()
def accuracy(model, tasks):
    result = []
    for _, _, x, y in tasks:
        logits = (
            model.logits(x)
            if isinstance(model, FrozenProtectedClassifier)
            else model(x).numpy()
        )
        result.append(float((logits.argmax(1) == y.numpy()).mean()))
    return result


def main():
    Path("reports").mkdir(exist_ok=True)
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=1500)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument(
        "--dataset",
        choices=["split-mnist", "permuted-mnist", "split-cifar100"],
        default="split-mnist",
    )
    args = parser.parse_args()
    torch.set_num_threads(2)
    rows = []
    for seed in range(5):
        tasks, classes = data_tasks(args.dataset, args.samples, seed)
        torch.manual_seed(seed)
        initial_model = MLP(tasks[0][0].shape[1], 128, classes)
        initial = accuracy(initial_model, tasks)
        isolated = []
        for x, y, tx, ty in tasks:
            model = deepcopy(initial_model)
            train(model, x, y, args.epochs, torch.Generator().manual_seed(seed))
            isolated.append(accuracy(model, [(x, y, tx, ty)])[0])
        for method in ("finetune", "ewc", "replay", "gpm", "protected", "multitask"):
            model = deepcopy(initial_model)
            gen = torch.Generator().manual_seed(seed)
            ewc = OnlineEWC(model) if method == "ewc" else None
            gpm = LayerwiseGPM(model) if method == "gpm" else None
            matrices = []
            replay_x = []
            replay_y = []
            cka = 1.0
            reference = None
            free_dims = 129
            for task, (x, y, _, _) in enumerate(tasks):
                if method == "protected" and task > 0:
                    for _ in range(args.epochs):
                        for idx in torch.randperm(len(x), generator=gen).split(128):
                            model.train_batch(x[idx], y[idx])
                else:
                    xx, yy = x, y
                    if method == "replay" and replay_x:
                        xx, yy = torch.cat([x, *replay_x]), torch.cat([y, *replay_y])
                    if method == "multitask":
                        xx, yy = (
                            torch.cat([t[0] for t in tasks[: task + 1]]),
                            torch.cat([t[1] for t in tasks[: task + 1]]),
                        )
                    train(model, xx, yy, args.epochs, gen, ewc, gpm)
                if method == "protected":
                    if task == 0:
                        model = FrozenProtectedClassifier(model)
                    model.head.consolidate(model.features(x))
                    free_dims = model.head.free_dims
                elif ewc:
                    ewc.consolidate(model, x[:64], y[:64])
                elif gpm:
                    gpm.consolidate(model, x[:256])
                replay_x.append(x[:64])
                replay_y.append(y[:64])
                with torch.no_grad():
                    features = model.features(tasks[0][2][:256])
                    if isinstance(features, torch.Tensor):
                        features = features.numpy()
                if reference is None:
                    reference = features.copy()
                cka = linear_cka(reference, features)
                matrices.append(accuracy(model, tasks))
            metrics = continual_metrics(matrices, initial, isolated)
            rows.append(
                dict(
                    seed=seed,
                    method=method,
                    dataset=args.dataset,
                    samples_per_task=args.samples,
                    epochs=args.epochs,
                    cka=cka,
                    free_dims=free_dims if method == "protected" else "",
                    **metrics,
                )
            )
            np.save(
                f"reports/accuracy_{args.dataset}_{method}_{seed}.npy",
                np.asarray(matrices),
            )
            print(seed, method, metrics, flush=True)
    p = paired(
        [r["fm"] for r in rows if r["method"] == "protected"],
        [r["fm"] for r in rows if r["method"] == "finetune"],
    )
    previous = []
    if Path("reports/phase3.csv").exists():
        with Path("reports/phase3.csv").open() as stream:
            previous = [
                {k: parse(v) for k, v in row.items()}
                for row in csv.DictReader(stream)
                if row["dataset"] != args.dataset
            ]
    write_report(
        3,
        previous + rows,
        f"Resultados agrupados por dataset e método. Última execução: {args.dataset}: 5 sementes, {args.samples or 'todos'} exemplos por tarefa, {args.epochs} épocas, classificação global sem oráculo. p pareado de FM protegido vs fine-tuning: {p:.6g}.",
        "Métodos têm mesmos dados novos; replay/multitask usam exemplos adicionais explicitamente. GPM usa 95% de energia; proteção exata usa span completo. Saturação e plasticidade negativa são resultados válidos. Este ensaio reduzido não substitui os três benchmarks completos. Consulte CSV por método, não a média agregada entre métodos.",
    )


if __name__ == "__main__":
    main()
