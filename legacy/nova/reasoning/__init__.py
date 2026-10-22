"""Budgeted search, exact arithmetic tools, and held-out confidence calibration."""

from __future__ import annotations
import ast
import operator
from collections import deque
from dataclasses import dataclass
import numpy as np
from scipy.optimize import minimize_scalar
from scipy.special import softmax


class Calculator:
    """Evaluate bounded arithmetic ASTs; no names, calls, attributes or code execution."""

    operations = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.Pow: operator.pow,
        ast.Mod: operator.mod,
    }

    def __call__(self, expression):
        if len(expression) > 512:
            raise ValueError("expression too long")
        tree = ast.parse(expression, mode="eval")
        if len(list(ast.walk(tree))) > 128:
            raise ValueError("expression too complex")

        def visit(node):
            if isinstance(node, ast.Constant) and type(node.value) in (int, float):
                value = node.value
            elif isinstance(node, ast.UnaryOp) and isinstance(
                node.op, (ast.UAdd, ast.USub)
            ):
                value = visit(node.operand) * (
                    1 if isinstance(node.op, ast.UAdd) else -1
                )
            elif isinstance(node, ast.BinOp) and type(node.op) in self.operations:
                a, b = visit(node.left), visit(node.right)
                if isinstance(node.op, ast.Pow) and abs(b) > 16:
                    raise ValueError("exponent budget exceeded")
                value = self.operations[type(node.op)](a, b)
            else:
                raise ValueError("only arithmetic is allowed")
            if (
                isinstance(value, complex)
                or not np.isfinite(value)
                or abs(value) > 1e100
            ):
                raise ValueError("result outside numeric budget")
            return value

        return visit(tree.body)


class ToolRegistry:
    def __init__(self):
        self.tools = {"calculator": Calculator()}

    def register(self, name, callback):
        if name in self.tools:
            raise ValueError("duplicate tool")
        self.tools[name] = callback

    def call(self, name, *args, **kwargs):
        if name not in self.tools:
            raise ValueError("tool not registered")
        return self.tools[name](*args, **kwargs)


@dataclass
class SearchResult:
    path: list[tuple[int, int]]
    expanded: int
    verified: bool


def grid_search(grid, start, goal, budget=1000):
    """Exact BFS verifier, bounded by expansions; more budget preserves found solutions."""
    grid = np.asarray(grid, dtype=bool)
    if grid.ndim != 2 or budget < 0:
        raise ValueError("invalid grid/budget")
    for p in (start, goal):
        if not 0 <= p[0] < grid.shape[0] or not 0 <= p[1] < grid.shape[1] or grid[p]:
            raise ValueError("invalid endpoint")
    start, goal = tuple(start), tuple(goal)
    queue = deque([start])
    parent = {start: None}
    expanded = 0
    while queue and expanded < budget:
        node = queue.popleft()
        expanded += 1
        if node == goal:
            path = []
            while node is not None:
                path.append(node)
                node = parent[node]
            return SearchResult(path[::-1], expanded, True)
        for delta in ((0, 1), (1, 0), (-1, 0), (0, -1)):
            nxt = (node[0] + delta[0], node[1] + delta[1])
            if (
                0 <= nxt[0] < grid.shape[0]
                and 0 <= nxt[1] < grid.shape[1]
                and not grid[nxt]
                and nxt not in parent
            ):
                parent[nxt] = node
                queue.append(nxt)
    return SearchResult([], expanded, False)


def hierarchical_route(grid, start, subgoals, budget=1000):
    path = [tuple(start)]
    used = 0
    for goal in subgoals:
        result = grid_search(grid, path[-1], tuple(goal), max(0, budget - used))
        used += result.expanded
        if not result.verified:
            return SearchResult([], used, False)
        path.extend(result.path[1:])
    return SearchResult(path, used, True)


def expected_calibration_error(probabilities, labels, bins=10):
    p = np.asarray(probabilities)
    labels = np.asarray(labels)
    if (
        p.ndim != 2
        or len(p) == 0
        or len(labels) != len(p)
        or np.any(p < 0)
        or not np.allclose(p.sum(1), 1)
    ):
        raise ValueError("invalid probability distribution")
    confidence = p.max(1)
    correct = p.argmax(1) == labels
    value = 0.0
    index = np.minimum((confidence * bins).astype(int), bins - 1)
    for i in range(bins):
        selected = index == i
        if selected.any():
            value += selected.mean() * abs(
                confidence[selected].mean() - correct[selected].mean()
            )
    return float(value)


class TemperatureCalibrator:
    def __init__(self):
        self.temperature = 1.0

    def fit(self, logits, labels):
        logits = np.asarray(logits)
        labels = np.asarray(labels)

        def nll(log_temperature):
            p = softmax(logits / np.exp(log_temperature), axis=1)
            return -np.log(np.maximum(p[np.arange(len(p)), labels], 1e-12)).mean()

        result = minimize_scalar(nll, bounds=(-4, 4), method="bounded")
        if not result.success:
            raise RuntimeError("calibration did not converge")
        self.temperature = float(np.exp(result.x))
        return self

    def predict(self, logits):
        return softmax(np.asarray(logits) / self.temperature, axis=1)
