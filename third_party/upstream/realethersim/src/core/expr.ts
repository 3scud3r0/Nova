// Safe math-expression compiler for user-authored systems (the "Custom" mode). The user types an
// expression like `sin(a*i/n*TAU + t)`; we tokenise it, parse it to an AST with a Pratt parser, and
// emit JavaScript FROM OUR OWN AST — never from the raw string — so the only things that can appear in
// the compiled function are numbers, the whitelisted variables (i,t,n), whitelisted constants and
// functions, arithmetic, and param lookups. An unknown function is a hard error; there is no way to
// smuggle arbitrary code through, which is what makes a compiled expression safe to SHARE (export in a
// snapshot / permalink / PNG and reload on someone else's machine). The result is a fast closure
// (compiled once, evaluated per point per frame), not a tree-walking interpreter.

// variables the expression may read
const VARS = new Set(['i', 't', 'n']);
// constants → emitted JS literal
const CONSTS: Record<string, string> = {
  PI: '(3.141592653589793)',
  TAU: '(6.283185307179586)',
  E: '(2.718281828459045)',
  PHI: '(1.618033988749895)',
};
// whitelisted functions → emitted JS (Math.* or a trusted helper H.*); value is the callee, arity checked
const FUNCS: Record<string, { js: string; arity: number | [number, number] }> = {
  sin: { js: 'Math.sin', arity: 1 }, cos: { js: 'Math.cos', arity: 1 }, tan: { js: 'Math.tan', arity: 1 },
  asin: { js: 'Math.asin', arity: 1 }, acos: { js: 'Math.acos', arity: 1 }, atan: { js: 'Math.atan', arity: 1 },
  atan2: { js: 'Math.atan2', arity: 2 },
  sinh: { js: 'Math.sinh', arity: 1 }, cosh: { js: 'Math.cosh', arity: 1 }, tanh: { js: 'Math.tanh', arity: 1 },
  exp: { js: 'Math.exp', arity: 1 }, log: { js: 'Math.log', arity: 1 }, log2: { js: 'Math.log2', arity: 1 }, log10: { js: 'Math.log10', arity: 1 },
  sqrt: { js: 'Math.sqrt', arity: 1 }, cbrt: { js: 'Math.cbrt', arity: 1 },
  abs: { js: 'Math.abs', arity: 1 }, sign: { js: 'Math.sign', arity: 1 },
  floor: { js: 'Math.floor', arity: 1 }, ceil: { js: 'Math.ceil', arity: 1 }, round: { js: 'Math.round', arity: 1 }, trunc: { js: 'Math.trunc', arity: 1 },
  min: { js: 'Math.min', arity: 2 }, max: { js: 'Math.max', arity: 2 }, pow: { js: 'Math.pow', arity: 2 }, hypot: { js: 'Math.hypot', arity: 2 },
  mod: { js: 'H.mod', arity: 2 }, clamp: { js: 'H.clamp', arity: 3 }, mix: { js: 'H.mix', arity: 3 }, smoothstep: { js: 'H.smoothstep', arity: 3 }, step: { js: 'H.step', arity: 2 },
  gauss: { js: 'H.gauss', arity: 1 }, fract: { js: 'H.fract', arity: 1 },
};

// trusted helpers referenced by the compiled function (never user-controlled)
export const EXPR_HELPERS = {
  mod: (a: number, b: number): number => ((a % b) + b) % b,
  clamp: (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi),
  mix: (a: number, b: number, u: number): number => a + (b - a) * u,
  step: (edge: number, x: number): number => (x < edge ? 0 : 1),
  smoothstep: (a: number, b: number, x: number): number => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-9)));
    return u * u * (3 - 2 * u);
  },
  gauss: (x: number): number => Math.exp(-x * x),
  fract: (x: number): number => x - Math.floor(x),
};

export type CompiledFn = (i: number, t: number, n: number, P: Record<string, number>) => number;
export interface CompileOk { ok: true; fn: CompiledFn; params: string[] }
export interface CompileErr { ok: false; error: string }
export type CompileResult = CompileOk | CompileErr;

// ── tokeniser ──
type Tok = { k: 'num' | 'id' | 'op' | 'lp' | 'rp' | 'comma'; v: string; pos: number };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let p = 0;
  const isDigit = (c: string): boolean => c >= '0' && c <= '9';
  const isIdStart = (c: string): boolean => /[A-Za-z_]/.test(c);
  const isIdPart = (c: string): boolean => /[A-Za-z0-9_]/.test(c);
  while (p < src.length) {
    const c = src[p];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { p++; continue; }
    if (isDigit(c) || (c === '.' && isDigit(src[p + 1] ?? ''))) {
      let s = p; p++;
      while (p < src.length && (isDigit(src[p]) || src[p] === '.')) p++;
      // exponent
      if (src[p] === 'e' || src[p] === 'E') { p++; if (src[p] === '+' || src[p] === '-') p++; while (p < src.length && isDigit(src[p])) p++; }
      toks.push({ k: 'num', v: src.slice(s, p), pos: s });
      continue;
    }
    if (isIdStart(c)) {
      let s = p; p++;
      while (p < src.length && isIdPart(src[p])) p++;
      toks.push({ k: 'id', v: src.slice(s, p), pos: s });
      continue;
    }
    if (c === '(') { toks.push({ k: 'lp', v: c, pos: p++ }); continue; }
    if (c === ')') { toks.push({ k: 'rp', v: c, pos: p++ }); continue; }
    if (c === ',') { toks.push({ k: 'comma', v: c, pos: p++ }); continue; }
    if ('+-*/^%'.includes(c)) { toks.push({ k: 'op', v: c, pos: p++ }); continue; }
    throw new ExprError(`unexpected character "${c}"`, p);
  }
  return toks;
}

class ExprError extends Error {
  constructor(msg: string, readonly pos: number) { super(msg); }
}

// ── Pratt parser → emits JS string, collecting free params along the way ──
// precedence: (+ −) < (* / %) < unary(− +) < ^(right-assoc), so −2^2 = −(2^2) and 2^−3 parses.
const BINPREC: Record<string, number> = { '+': 10, '-': 10, '*': 20, '/': 20, '%': 20 };

function parse(src: string, params: Set<string>): string {
  const toks = tokenize(src);
  let idx = 0;
  const peek = (): Tok | undefined => toks[idx];
  const next = (): Tok => { const t = toks[idx++]; if (!t) throw new ExprError('unexpected end of expression', src.length); return t; };

  function parseExpr(minPrec: number): string {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (!t || t.k !== 'op') break;
      const prec = BINPREC[t.v];
      if (prec === undefined || prec < minPrec) break;
      next();
      const right = parseExpr(prec + 1); // + − * / % are all left-associative
      left = `(${left}${t.v}${right})`;
    }
    return left;
  }

  function parseUnary(): string {
    const t = peek();
    if (t && t.k === 'op' && (t.v === '-' || t.v === '+')) {
      next();
      const operand = parseUnary();
      return t.v === '-' ? `(-${operand})` : operand;
    }
    return parsePower();
  }

  // ^ binds tighter than unary and is right-associative
  function parsePower(): string {
    const base = parsePrimary();
    if (peek()?.k === 'op' && peek()?.v === '^') {
      next();
      const exp = parseUnary(); // right side may carry its own unary sign / further ^
      return `Math.pow(${base},${exp})`;
    }
    return base;
  }

  function parsePrimary(): string {
    const t = next();
    if (t.k === 'num') {
      if (!Number.isFinite(Number(t.v))) throw new ExprError(`bad number "${t.v}"`, t.pos);
      return `(${Number(t.v)})`;
    }
    if (t.k === 'lp') {
      const inner = parseExpr(0);
      const r = next();
      if (r.k !== 'rp') throw new ExprError('expected ")"', r.pos);
      return `(${inner})`;
    }
    if (t.k === 'id') {
      const name = t.v;
      // function call?
      if (peek()?.k === 'lp') {
        const fn = Object.hasOwn(FUNCS, name) ? FUNCS[name] : undefined;
        if (!fn) throw new ExprError(`unknown function "${name}"`, t.pos);
        next(); // consume (
        const args: string[] = [];
        if (peek()?.k !== 'rp') {
          args.push(parseExpr(0));
          while (peek()?.k === 'comma') { next(); args.push(parseExpr(0)); }
        }
        const rp = next();
        if (rp.k !== 'rp') throw new ExprError('expected ")"', rp.pos);
        const [lo, hi] = Array.isArray(fn.arity) ? fn.arity : [fn.arity, fn.arity];
        if (args.length < lo || args.length > hi) {
          throw new ExprError(`${name}() expects ${Array.isArray(fn.arity) ? `${lo}–${hi}` : lo} argument${lo === 1 ? '' : 's'}, got ${args.length}`, t.pos);
        }
        return `${fn.js}(${args.join(',')})`;
      }
      // variable / constant / free param (Object.hasOwn so inherited keys like "constructor" don't leak)
      if (VARS.has(name)) return name;
      if (Object.hasOwn(CONSTS, name)) return CONSTS[name];
      if (Object.hasOwn(FUNCS, name)) throw new ExprError(`"${name}" is a function — did you mean ${name}(…)?`, t.pos);
      // otherwise a free parameter — coerce to a number so inherited object props (constructor,
      // __proto__, …) resolve to 0 rather than a function/object, and a missing param is 0
      params.add(name);
      return `(+(P[${JSON.stringify(name)}])||0)`;
    }
    throw new ExprError(`unexpected "${t.v}"`, t.pos);
  }

  const js = parseExpr(0);
  if (idx < toks.length) throw new ExprError(`unexpected "${toks[idx].v}"`, toks[idx].pos);
  return js;
}

// Compile a single expression string into a fast, safe closure. Returns the free parameter names it
// references (so the UI can offer knobs) or a human-readable error.
export function compileExpr(src: string): CompileResult {
  const trimmed = (src ?? '').trim();
  if (!trimmed) return { ok: false, error: 'empty expression' };
  const params = new Set<string>();
  let js: string;
  try {
    js = parse(trimmed, params);
  } catch (e) {
    const err = e as ExprError;
    return { ok: false, error: typeof err.pos === 'number' ? `${err.message} (at ${err.pos})` : (err as Error).message };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const raw = new Function('i', 't', 'n', 'P', 'H', `"use strict";return (${js});`) as
      (i: number, t: number, n: number, P: Record<string, number>, H: typeof EXPR_HELPERS) => number;
    const fn: CompiledFn = (i, t, n, P) => raw(i, t, n, P, EXPR_HELPERS);
    // smoke-test the compiled fn once so obviously-broken expressions fail at compile, not per frame
    const probe = fn(0, 0, 1, {});
    if (typeof probe !== 'number') return { ok: false, error: 'expression did not evaluate to a number' };
    return { ok: true, fn, params: [...params].sort() };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
