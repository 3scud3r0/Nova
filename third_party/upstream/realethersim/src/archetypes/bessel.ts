// Bessel functions of the first kind Jₙ(x) and their positive zeros. Shared by the circular-membrane
// systems (drumhead Chladni plate, cymatics Faraday waves). Abramowitz & Stegun rational/asymptotic
// J0/J1 (err < 1e-7, stable ∀x) + Numerical-Recipes recurrence for Jₙ + McMahon/Newton for the zeros.

export function besselJ0(x: number): number {
  const ax = Math.abs(x);
  if (ax < 8) {
    const y = x * x;
    const p1 = 57568490574 + y * (-13362590354 + y * (651619640.7 + y * (-11214424.18 + y * (77392.33017 + y * -184.9052456))));
    const p2 = 57568490411 + y * (1029532985 + y * (9494680.718 + y * (59272.64853 + y * (267.8532712 + y))));
    return p1 / p2;
  }
  const z = 8 / ax;
  const y = z * z;
  const xx = ax - 0.785398164;
  const p1 = 1 + y * (-0.1098628627e-2 + y * (0.2734510407e-4 + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
  const p2 = -0.1562499995e-1 + y * (0.1430488765e-3 + y * (-0.6911147651e-5 + y * (0.7621095161e-6 + y * -0.934935152e-7)));
  return Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p1 - z * Math.sin(xx) * p2);
}

export function besselJ1(x: number): number {
  const ax = Math.abs(x);
  let ans: number;
  if (ax < 8) {
    const y = x * x;
    const p1 = x * (72362614232 + y * (-7895059235 + y * (242396853.1 + y * (-2972611.439 + y * (15704.4826 + y * -30.16036606)))));
    const p2 = 144725228442 + y * (2300535178 + y * (18583304.74 + y * (99447.43394 + y * (376.9991397 + y))));
    ans = p1 / p2;
  } else {
    const z = 8 / ax;
    const y = z * z;
    const xx = ax - 2.356194491;
    const p1 = 1 + y * (0.183105e-2 + y * (-0.3516396496e-4 + y * (0.2457520174e-5 + y * -0.240337019e-6)));
    const p2 = 0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5 + y * (-0.88228987e-6 + y * 0.105787412e-6)));
    ans = Math.sqrt(0.636619772 / ax) * (Math.cos(xx) * p1 - z * Math.sin(xx) * p2);
    if (x < 0) ans = -ans;
  }
  return ans;
}

// Jₙ(x) via the Numerical-Recipes `bessj` scheme: stable upward recurrence for x>n, Miller's downward
// recurrence (with renormalisation) for x≤n.
export function besselJn(n: number, x: number): number {
  if (n === 0) return besselJ0(x);
  if (n === 1) return besselJ1(x);
  const ax = Math.abs(x);
  if (ax === 0) return 0;
  let ans: number;
  if (ax > n) {
    const tox = 2 / ax;
    let bjm = besselJ0(ax);
    let bj = besselJ1(ax);
    for (let j = 1; j < n; j++) {
      const bjp = j * tox * bj - bjm;
      bjm = bj;
      bj = bjp;
    }
    ans = bj;
  } else {
    const tox = 2 / ax;
    const m = 2 * Math.floor((n + Math.floor(Math.sqrt(40 * n))) / 2);
    let jsum = 0;
    let bjp = 0;
    let bj = 1;
    let sum = 0;
    let bjn = 0;
    for (let j = m; j > 0; j--) {
      const bjm = j * tox * bj - bjp;
      bjp = bj;
      bj = bjm;
      if (Math.abs(bj) > 1e10) {
        bj *= 1e-10;
        bjp *= 1e-10;
        bjn *= 1e-10;
        sum *= 1e-10;
      }
      if (jsum) sum += bj;
      jsum = jsum ? 0 : 1;
      if (j === n) bjn = bjp;
    }
    sum = 2 * sum - bj; // normalisation: Σ even-order = J0 + 2(J2+J4+…) = 1
    ans = bjn / sum;
  }
  return x < 0 && (n & 1) ? -ans : ans;
}

// The k-th positive zero of Jₘ (k ≥ 1): McMahon asymptotic guess, refined by Newton (Jₘ' from neighbours).
export function besselJzero(m: number, k: number): number {
  const b = (k + m / 2 - 0.25) * Math.PI;
  let x = b - (4 * m * m - 1) / (8 * b);
  for (let it = 0; it < 10; it++) {
    const j = besselJn(m, x);
    const jp = m === 0 ? -besselJn(1, x) : 0.5 * (besselJn(m - 1, x) - besselJn(m + 1, x));
    if (jp === 0) break;
    const dx = j / jp;
    x -= dx;
    if (Math.abs(dx) < 1e-12) break;
  }
  return x;
}
