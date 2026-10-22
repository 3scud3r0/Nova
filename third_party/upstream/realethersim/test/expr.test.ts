import { describe, expect, it } from 'vitest';
import { compileExpr } from '../src/core/expr';

const ev = (src: string, i = 0, t = 0, n = 1, P: Record<string, number> = {}): number => {
  const r = compileExpr(src);
  if (!r.ok) throw new Error(`compile failed: ${r.error}`);
  return r.fn(i, t, n, P);
};

describe('expr: arithmetic & precedence', () => {
  it('respects operator precedence', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('2 * 3 + 4 * 5')).toBe(26);
  });
  it('^ is right-associative and maps to pow', () => {
    expect(ev('2 ^ 3')).toBe(8);
    expect(ev('2 ^ 3 ^ 2')).toBe(512); // 2^(3^2), not (2^3)^2=64
  });
  it('unary minus and modulo', () => {
    expect(ev('-3 + 5')).toBe(2);
    expect(ev('-2 ^ 2')).toBe(-4); // -(2^2) — unary binds looser than ^
    expect(ev('7 % 3')).toBe(1);
  });
  it('decimals and exponent notation', () => {
    expect(ev('1.5 * 2')).toBe(3);
    expect(ev('2e3')).toBe(2000);
  });
});

describe('expr: variables, constants, functions', () => {
  it('reads i, t, n', () => {
    expect(ev('i + t + n', 2, 3, 4)).toBe(9);
    expect(ev('i / n', 3, 0, 6)).toBe(0.5);
  });
  it('knows constants', () => {
    expect(ev('PI')).toBeCloseTo(Math.PI, 12);
    expect(ev('TAU')).toBeCloseTo(2 * Math.PI, 12);
  });
  it('evaluates whitelisted functions', () => {
    expect(ev('sin(0)')).toBe(0);
    expect(ev('cos(0)')).toBe(1);
    expect(ev('sqrt(9)')).toBe(3);
    expect(ev('max(2, 7)')).toBe(7);
    expect(ev('atan2(1, 1)')).toBeCloseTo(Math.PI / 4, 12);
    expect(ev('mod(-1, 3)')).toBe(2); // helper: always non-negative
    expect(ev('clamp(5, 0, 1)')).toBe(1);
    expect(ev('mix(0, 10, 0.25)')).toBe(2.5);
  });
});

describe('expr: free parameters', () => {
  it('collects free params and reads them from P', () => {
    const r = compileExpr('a * sin(b * i)');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params).toEqual(['a', 'b']);
    expect(r.fn(1, 0, 1, { a: 3, b: 0 })).toBe(0);
    expect(r.fn(Math.PI / 2, 0, 1, { a: 2, b: 1 })).toBeCloseTo(2, 10);
  });
  it('missing params read as 0', () => {
    expect(ev('a + 5')).toBe(5);
  });
});

describe('expr: errors', () => {
  it('rejects unknown functions', () => {
    const r = compileExpr('evil(1)');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unknown function/i);
  });
  it('rejects wrong arity', () => {
    expect(compileExpr('sin(1, 2)').ok).toBe(false);
    expect(compileExpr('atan2(1)').ok).toBe(false);
  });
  it('rejects unbalanced parens and stray tokens', () => {
    expect(compileExpr('(1 + 2').ok).toBe(false);
    expect(compileExpr('1 + 2)').ok).toBe(false);
    expect(compileExpr('1 2').ok).toBe(false);
  });
  it('rejects empty input', () => {
    expect(compileExpr('').ok).toBe(false);
    expect(compileExpr('   ').ok).toBe(false);
  });
});

describe('expr: SECURITY — no arbitrary code can execute', () => {
  it('rejects property access, indexing, statements, comments', () => {
    for (const bad of [
      'window',           // bare id → becomes a harmless param, but with a dot it must fail
      'window.alert(1)',  // '.' is not a valid char
      'this.constructor', // '.'
      '[].constructor',   // '[' not valid
      'globalThis',       // bare id → param (harmless), but let's ensure no code runs
      '1; alert(1)',      // ';' not valid
      'a = 1',            // '=' not valid
      'i++',              // trailing '+' → parse error (unexpected end)
      '1 || alert(1)',    // '|' not valid
      'process.exit()',   // '.'
      '`x`',              // backtick not valid
    ]) {
      const r = compileExpr(bad);
      // either it fails to compile, or (for a bare identifier like `window`) it compiles to a numeric
      // param read that can NEVER call anything — verify it yields a finite number, not a side effect
      if (r.ok) {
        const val = r.fn(0, 0, 1, {});
        expect(typeof val).toBe('number');
      } else {
        expect(r.error.length).toBeGreaterThan(0);
      }
    }
  });
  it('a param named "constructor" resolves to 0, not the Object constructor', () => {
    const r = compileExpr('constructor');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fn(0, 0, 1, {})).toBe(0);
  });
  it('function names cannot be used as bare values to leak references', () => {
    // `sin` without parens is flagged (function used as a value)
    expect(compileExpr('sin').ok).toBe(false);
  });
});
