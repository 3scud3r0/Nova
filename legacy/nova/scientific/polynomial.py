"""Bounded exact rational polynomials parsed from an arithmetic-only AST."""

from __future__ import annotations
import ast
from fractions import Fraction
import re
import numpy as np


class Polynomial:
    max_terms = 512
    max_degree = 8

    def __init__(self, variables, terms=None):
        self.variables = tuple(variables)
        if (
            not 1 <= len(self.variables) <= 16
            or len(set(self.variables)) != len(self.variables)
            or any(
                not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_]{0,31}", v)
                for v in self.variables
            )
        ):
            raise ValueError("invalid polynomial variables")
        self.terms = {tuple(m): Fraction(c) for m, c in (terms or {}).items() if c}
        if len(self.terms) > self.max_terms:
            raise ValueError("polynomial term budget exceeded")
        for m, c in self.terms.items():
            if (
                len(m) != len(self.variables)
                or any(not isinstance(p, int) or p < 0 for p in m)
                or sum(m) > self.max_degree
                or max(abs(c.numerator).bit_length(), c.denominator.bit_length()) > 512
            ):
                raise ValueError("polynomial degree/coefficient budget exceeded")

    def constant(self, value):
        return Polynomial(self.variables, {(0,) * len(self.variables): Fraction(value)})

    def _coerce(self, other):
        if not isinstance(other, Polynomial):
            other = self.constant(other)
        if other.variables != self.variables:
            raise ValueError("variable context mismatch")
        return other

    def __add__(self, other):
        other = self._coerce(other)
        terms = self.terms.copy()
        for m, c in other.terms.items():
            terms[m] = terms.get(m, Fraction(0)) + c
        return Polynomial(self.variables, terms)

    def __neg__(self):
        return Polynomial(self.variables, {m: -c for m, c in self.terms.items()})

    def __sub__(self, other):
        return self + -self._coerce(other)

    def __mul__(self, other):
        other = self._coerce(other)
        terms = {}
        if len(self.terms) * len(other.terms) > 65536:
            raise ValueError("polynomial expansion budget exceeded")
        for a, c in self.terms.items():
            for b, d in other.terms.items():
                m = tuple(x + y for x, y in zip(a, b))
                terms[m] = terms.get(m, Fraction(0)) + c * d
        return Polynomial(self.variables, terms)

    def derivative(self, index):
        result = {}
        for m, c in self.terms.items():
            if m[index]:
                n = list(m)
                n[index] -= 1
                result[tuple(n)] = c * m[index]
        return Polynomial(self.variables, result)

    def evaluate(self, x):
        x = np.asarray(x, dtype=float)
        if x.shape[-1] != len(self.variables):
            raise ValueError("polynomial input dimension mismatch")
        out = np.zeros(x.shape[:-1])
        for powers, c in self.terms.items():
            out += float(c) * np.prod(x ** np.asarray(powers), axis=-1)
        return out

    def expression(self):
        if not self.terms:
            return "0"
        terms = []
        for powers, c in sorted(self.terms.items()):
            factors = [f"({c.numerator}/{c.denominator})"]
            factors.extend(
                name if power == 1 else f"({name}**{power})"
                for name, power in zip(self.variables, powers)
                if power
            )
            terms.append("*".join(factors))
        return "(" + "+".join(terms) + ")"

    def to_dict(self):
        return {
            "variables": list(self.variables),
            "terms": [[list(m), str(c)] for m, c in sorted(self.terms.items())],
        }

    @classmethod
    def from_dict(cls, data):
        return cls(data["variables"], {tuple(m): Fraction(c) for m, c in data["terms"]})

    @classmethod
    def parse(cls, expression, variables):
        if not isinstance(expression, str) or len(expression) > 16384:
            raise ValueError("expression too large")
        tree = ast.parse(expression, mode="eval")
        if len(list(ast.walk(tree))) > 2048:
            raise ValueError("expression tree budget exceeded")
        base = cls(variables)
        names = {
            name: cls(variables, {tuple(int(i == j) for i in range(len(variables))): 1})
            for j, name in enumerate(variables)
        }

        def visit(node):
            if isinstance(node, ast.Name) and node.id in names:
                return names[node.id]
            if isinstance(node, ast.Constant) and type(node.value) in (int, float):
                return base.constant(Fraction(str(node.value)))
            if isinstance(node, ast.UnaryOp) and isinstance(
                node.op, (ast.USub, ast.UAdd)
            ):
                value = visit(node.operand)
                return -value if isinstance(node.op, ast.USub) else value
            if isinstance(node, ast.BinOp):
                left = visit(node.left)
                if isinstance(node.op, ast.Pow):
                    if (
                        not isinstance(node.right, ast.Constant)
                        or type(node.right.value) != int
                        or not 0 <= node.right.value <= cls.max_degree
                    ):
                        raise ValueError("invalid exponent")
                    value = base.constant(1)
                    for _ in range(node.right.value):
                        value = value * left
                    return value
                right = visit(node.right)
                if isinstance(node.op, ast.Add):
                    return left + right
                if isinstance(node.op, ast.Sub):
                    return left - right
                if isinstance(node.op, ast.Mult):
                    return left * right
                if isinstance(node.op, ast.Div):
                    zero = (0,) * len(variables)
                    if set(right.terms) != {zero}:
                        raise ValueError("division requires nonzero rational constant")
                    return left * base.constant(1 / right.terms[zero])
            raise ValueError("only bounded polynomial arithmetic is supported")

        return visit(tree.body)
