"""Bounded transcendental expression trees; strict domains, no eval or peer code."""

from __future__ import annotations
import ast
from dataclasses import dataclass
from fractions import Fraction
import numpy as np


@dataclass(frozen=True)
class Expression:
    op: str
    args: tuple = ()
    value: str = ""

    def size(self):
        return 1 + sum(a.size() for a in self.args)

    @classmethod
    def constant(cls, value):
        return cls("const", (), str(Fraction(str(value))))

    def evaluate(self, x, variables):
        x = np.asarray(x, dtype=float)
        if self.op == "const":
            return np.full(x.shape[:-1], float(Fraction(self.value)))
        if self.op == "var":
            return x[..., variables.index(self.value)]
        a = [v.evaluate(x, variables) for v in self.args]
        with np.errstate(all="ignore"):
            if self.op == "add":
                out = a[0] + a[1]
            elif self.op == "sub":
                out = a[0] - a[1]
            elif self.op == "mul":
                out = a[0] * a[1]
            elif self.op == "div":
                out = np.divide(a[0], a[1])
            elif self.op == "sin":
                out = np.sin(a[0])
            elif self.op == "cos":
                out = np.cos(a[0])
            elif self.op == "exp":
                out = np.exp(a[0])
            elif self.op == "log":
                out = np.log(a[0])
            elif self.op == "sqrt":
                out = np.sqrt(a[0])
            else:
                raise ValueError("unknown expression operator")
        if not np.isfinite(out).all():
            raise ValueError("expression outside its real/finite domain")
        return out

    def derivative(self, variable):
        C = Expression.constant
        E = Expression
        if self.op == "const":
            return C(0)
        if self.op == "var":
            return C(int(self.value == variable))
        a = self.args[0]
        da = a.derivative(variable)
        if self.op in ("add", "sub"):
            return E(self.op, (da, self.args[1].derivative(variable))).simplify()
        if self.op == "mul":
            b = self.args[1]
            return E(
                "add", (E("mul", (da, b)), E("mul", (a, b.derivative(variable))))
            ).simplify()
        if self.op == "div":
            b = self.args[1]
            return E(
                "div",
                (
                    E(
                        "sub",
                        (E("mul", (da, b)), E("mul", (a, b.derivative(variable)))),
                    ),
                    E("mul", (b, b)),
                ),
            ).simplify()
        if self.op == "sin":
            outer = E("cos", (a,))
        elif self.op == "cos":
            outer = E("mul", (C(-1), E("sin", (a,))))
        elif self.op == "exp":
            outer = E("exp", (a,))
        elif self.op == "log":
            outer = E("div", (C(1), a))
        elif self.op == "sqrt":
            outer = E("div", (C(1), E("mul", (C(2), E("sqrt", (a,))))))
        else:
            raise ValueError("unknown derivative operator")
        return E("mul", (outer, da)).simplify()

    def simplify(self):
        if not self.args:
            return self
        args = tuple(a.simplify() for a in self.args)
        a = args[0]
        b = args[1] if len(args) > 1 else None
        zero = lambda v: v.op == "const" and Fraction(v.value) == 0
        one = lambda v: v.op == "const" and Fraction(v.value) == 1
        # Preserve undefined domains: 0*log(x) must not erase log's domain.
        if self.op == "mul" and (
            (zero(a) and b.op in ("const", "var"))
            or (zero(b) and a.op in ("const", "var"))
        ):
            return self.constant(0)
        if self.op in ("add", "sub") and zero(b):
            return a
        if self.op == "add" and zero(a):
            return b
        if self.op == "mul" and one(a):
            return b
        if self.op == "mul" and one(b):
            return a
        return Expression(self.op, args, self.value)

    def text(self):
        if self.op in ("const", "var"):
            return f"({self.value})" if self.op == "const" else self.value
        if self.op in ("sin", "cos", "exp", "log", "sqrt"):
            return f"{self.op}({self.args[0].text()})"
        symbol = {"add": "+", "sub": "-", "mul": "*", "div": "/"}[self.op]
        return f"({self.args[0].text()}{symbol}{self.args[1].text()})"

    def to_dict(self):
        return {
            "op": self.op,
            "value": self.value,
            "args": [a.to_dict() for a in self.args],
        }

    @classmethod
    def parse(cls, source, variables):
        if not isinstance(source, str) or len(source) > 4096:
            raise ValueError("expression size exceeded")
        if (
            len(set(variables)) != len(variables)
            or not 1 <= len(variables) <= 8
            or any(
                not name.isidentifier() or not name.isascii() or name.startswith("_")
                for name in variables
            )
        ):
            raise ValueError("invalid variables")
        tree = ast.parse(source, mode="eval")
        if len(list(ast.walk(tree))) > 128:
            raise ValueError("expression tree budget exceeded")

        def visit(node, depth=0):
            if depth > 12:
                raise ValueError("expression depth exceeded")
            if isinstance(node, ast.Name) and node.id in variables:
                return cls("var", (), node.id)
            if isinstance(node, ast.Constant) and type(node.value) in (int, float):
                value = Fraction(str(node.value))
                if (
                    max(
                        abs(value.numerator).bit_length(),
                        value.denominator.bit_length(),
                    )
                    > 256
                ):
                    raise ValueError("constant too large")
                return cls.constant(value)
            if isinstance(node, ast.UnaryOp) and isinstance(
                node.op, (ast.USub, ast.UAdd)
            ):
                a = visit(node.operand, depth + 1)
                return (
                    cls("mul", (cls.constant(-1), a))
                    if isinstance(node.op, ast.USub)
                    else a
                )
            if isinstance(node, ast.BinOp):
                a = visit(node.left, depth + 1)
                if isinstance(node.op, ast.Pow):
                    if (
                        not isinstance(node.right, ast.Constant)
                        or type(node.right.value) != int
                        or not 0 <= node.right.value <= 4
                    ):
                        raise ValueError("power budget exceeded")
                    out = cls.constant(1)
                    for _ in range(node.right.value):
                        out = cls("mul", (out, a))
                    return out.simplify()
                kinds = {
                    ast.Add: "add",
                    ast.Sub: "sub",
                    ast.Mult: "mul",
                    ast.Div: "div",
                }
                if type(node.op) not in kinds:
                    raise ValueError("operator not allowed")
                return cls(kinds[type(node.op)], (a, visit(node.right, depth + 1)))
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id in ("sin", "cos", "exp", "log", "sqrt")
                and len(node.args) == 1
                and not node.keywords
            ):
                return cls(node.func.id, (visit(node.args[0], depth + 1),))
            raise ValueError(
                "only declared arithmetic operators/functions are accepted"
            )

        result = visit(tree.body).simplify()
        if result.size() > 128:
            raise ValueError("expanded expression budget exceeded")
        return result


class NonPolynomialRegressor:
    """Sparse measured search over finite operator combinations with domain rejection."""

    def __init__(self, max_features=128, max_terms=8):
        if not 4 <= max_features <= 256 or not 1 <= max_terms <= 16:
            raise ValueError("symbolic search budget exceeded")
        self.max_features, self.max_terms = max_features, max_terms

    def fit(self, x, y, variables, *, groups=None):
        x = np.asarray(x, dtype=float)
        y = np.asarray(y, dtype=float)
        if (
            x.ndim != 2
            or not 12 <= len(x) <= 50000
            or not 1 <= x.shape[1] <= 8
            or x.shape[1] != len(variables)
            or y.shape != (len(x),)
            or not np.isfinite(x).all()
            or not np.isfinite(y).all()
        ):
            raise ValueError("invalid discovery observations")
        sources = ["1"] + list(variables)
        for name in variables:
            sources.extend(
                [f"{op}({name})" for op in ("sin", "cos", "exp", "log", "sqrt")]
                + [f"{name}**2", f"{name}**3"]
            )
        for i, a in enumerate(variables):
            for b in variables[i:]:
                sources.extend([f"{a}*{b}", f"{a}*sin({b})", f"{a}/(1+{b}**2)"])
        expressions = []
        columns = []
        rejected = []
        for source in dict.fromkeys(sources):
            if len(expressions) >= self.max_features:
                break
            expression = Expression.parse(source, variables)
            try:
                column = expression.evaluate(x, variables)
            except ValueError:
                rejected.append(source)
                continue
            expressions.append(expression)
            columns.append(column)
        design = np.stack(columns, axis=1)
        if groups is None:
            train = np.arange(len(x)) < int(0.75 * len(x))
            split = "ordered_block"
        else:
            groups = np.asarray(groups)
            unique = list(dict.fromkeys(groups.tolist()))
            if len(unique) < 2 or groups.shape != (len(x),):
                raise ValueError("multiple trajectory groups required")
            train = np.isin(groups, unique[: max(1, int(0.75 * len(unique)))])
            split = "trajectory_groups"
        if train.sum() < 4 or (~train).sum() < 2:
            raise ValueError("insufficient holdout")
        chosen = []
        available = list(range(design.shape[1]))
        residual = y[train].copy()
        best = float("inf")
        for _ in range(min(self.max_terms, len(available))):
            index = max(
                available,
                key=lambda i: (
                    abs(design[train, i] @ residual)
                    / max(np.linalg.norm(design[train, i]), 1e-12)
                ),
            )
            trial = chosen + [index]
            coef = np.linalg.lstsq(design[train][:, trial], y[train], rcond=1e-10)[0]
            error = y[train] - design[train][:, trial] @ coef
            objective = float(np.mean(error**2)) + len(trial) * 1e-6
            if chosen and objective >= best:
                break
            best = objective
            chosen = trial
            available.remove(index)
            residual = error
        coef = np.linalg.lstsq(design[train][:, chosen], y[train], rcond=1e-10)[0]
        formula = Expression.constant(0)
        for index, c in zip(chosen, coef):
            formula = Expression(
                "add",
                (
                    formula,
                    Expression(
                        "mul",
                        (
                            Expression.constant(
                                Fraction(float(c)).limit_denominator(100000)
                            ),
                            expressions[index],
                        ),
                    ),
                ),
            )
        formula = formula.simplify()
        prediction = formula.evaluate(x, variables)
        return {
            "status": "empirical_candidate",
            "expression": formula.text(),
            "tree": formula.to_dict(),
            "variables": list(variables),
            "train_mse": float(np.mean((prediction[train] - y[train]) ** 2)),
            "heldout_mse": float(np.mean((prediction[~train] - y[~train]) ** 2)),
            "baseline_mse": float(np.mean((y[~train] - y[train].mean()) ** 2)),
            "split": split,
            "domain_rejected": rejected,
            "features": len(expressions),
            "formal_proof": False,
        }


def grunwald_letnikov(values, alpha, dt, *, memory=256):
    """Causal finite-memory Grünwald–Letnikov derivative, specified zero prehistory.

    This is a numerical operator with truncation/boundary bias, not a symbolic
    universal fractional calculus theorem.
    """
    values = np.asarray(values, dtype=float)
    if (
        values.ndim != 1
        or not 1 <= len(values) <= 50000
        or not np.isfinite(values).all()
        or not 0 < alpha < 2
        or not np.isfinite(dt)
        or not dt > 0
        or not 1 <= memory <= 2048
    ):
        raise ValueError("fractional derivative budget/domain exceeded")
    weights = np.ones(min(memory, len(values)))
    for k in range(1, len(weights)):
        weights[k] = weights[k - 1] * (1 - (alpha + 1) / k)
    return np.convolve(values, weights, mode="full")[: len(values)] / dt**alpha


def vector_cross(left, right):
    left, right = np.asarray(left, dtype=float), np.asarray(right, dtype=float)
    if (
        left.ndim < 1
        or left.shape != right.shape
        or left.shape[-1] != 3
        or not np.isfinite(left).all()
        or not np.isfinite(right).all()
    ):
        raise ValueError("finite matching 3-vectors required")
    return np.cross(left, right)
