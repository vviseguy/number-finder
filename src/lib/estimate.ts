// Before a sum search runs: how big is it, will it finish in its time limit, and will sums match the
// target by coincidence? Pure math on the candidate values; shown under the search bar with ways to
// narrow the search, and never blocks it.
//
// Time. The engine tries single numbers (n steps), pairs (~M steps) and triples (~M²) directly, where
// M = n, or 2n with negatives (each number can enter as +v or −v). For 4+ numbers it walks partial sums
// depth-first and drops any partial sum that can no longer reach the target. So the work for sums of k
// numbers is roughly, over each depth d < k, C(M, d) partial sums times the share of them that can still
// reach the target with k − d more numbers; that share comes from a normal model of partial sums. When
// every entry is positive there is a tighter bound: the engine walks entries in sorted order, so the
// k − d numbers still to come are each at least the prefix's largest, m; with S ≥ m that needs
// m·(k − d + 1) ≤ target, so a prefix can only use the c entries at or below target / (k − d + 1), at
// most C(c, d) prefixes. Without it, "any count" over 40 numbers was overestimated ten-thousandfold. RATE
// (units a second) was measured against the real engine with scripts/bench-engine.mts and rounded down,
// so the estimate errs toward "this will be slow".
//
// Coincidences. The expected number of sums of 2+ numbers that land within the rounding window of the
// target by chance: for each size j and number of negatives i, C(n, j)·C(j, i) sums, spread roughly
// normally around (j − 2i)·mean with standard deviation √j·sd. Rough, but the right order of magnitude
// is what matters: "a sum or two" versus "many".

export interface SearchSize {
  /** Numbers the search would combine. */
  numbers: number;
  /** log10 of how many sums there are to try (with the allowed negative choices). */
  log10Combos: number;
  /** log10 of the engine work units (see above). */
  log10Work: number;
  /** Rough time to try every sum; Infinity when astronomically large. */
  seconds: number;
  /** Expected sums matching the target by chance; null without a target. */
  coincidences: number | null;
}

export interface SizeInput {
  values: number[];
  target: number | null;
  maxCount: number | null;
  minCount?: number;
  allowFlips: boolean;
  maxFlips?: number;
  /** ± how far a sum may be from the target. */
  tolerance: number;
}

/** Measured 8–50 × 10⁶ units a second (scripts/bench-engine.mts, 2026-09); set just under the slowest. */
export const RATE = 5e6;
const LOG_RATE = Math.log10(RATE);
const LOG_E = Math.log10(Math.E);
const LOG_SQRT_2PI = Math.log10(Math.sqrt(2 * Math.PI));
/** Sums of more numbers than this are left out of the time and coincidence sums; by then both are enormous. */
const MAX_MODELED_SIZE = 60;

function logAdd(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const hi = Math.max(a, b);
  return hi + Math.log10(1 + 10 ** (Math.min(a, b) - hi));
}

/** log10 C(n, k), for k ≤ n. */
function logChoose(n: number, k: number): number {
  let r = 0;
  for (let i = 1; i <= k; i++) r += Math.log10(n - k + i) - Math.log10(i);
  return r;
}

/** log10 erfc(x) for x ≥ 0 (Numerical Recipes' erfcc, relative error under 1.2e-7), in log space so far tails don't underflow. */
function logErfc(x: number): number {
  if (x === Infinity) return -Infinity;
  const t = 1 / (1 + 0.5 * x);
  const poly = -x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806
    + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  return Math.log10(t) + poly * LOG_E;
}

/** log10 Φ(z) for z ≤ 0: the lower tail of the standard normal. */
const logLowerTail = (z: number): number => Math.log10(0.5) + logErfc(-z / Math.SQRT2);

/** log10(Φ(b) − Φ(a)), a < b: the share of a normal distribution between a and b. */
export function logBetween(a: number, b: number): number {
  if (!(b > a)) return -Infinity;
  const floorLog = (x: number) => Math.log10(Math.max(1e-300, x));
  if (b <= 0) { const hi = logLowerTail(b); return hi + floorLog(1 - 10 ** (logLowerTail(a) - hi)); }
  if (a >= 0) { const hi = logLowerTail(-a); return hi + floorLog(1 - 10 ** (logLowerTail(-b) - hi)); }
  return floorLog(1 - 10 ** logLowerTail(a) - 10 ** logLowerTail(-b));
}

const meanOf = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const sdOf = (xs: number[], mean: number) => Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length);

export function estimateSearch(o: SizeInput): SearchSize {
  const vals = o.values.filter(v => Number.isFinite(v) && Math.abs(v) >= 0.005); // zeros never join a sum
  const n = vals.length;
  const kmax = Math.min(o.maxCount ?? n, n);
  const kmin = Math.max(1, o.minCount ?? 1);
  const flips = o.allowFlips && o.maxFlips !== 0;
  const fcap = flips ? (o.maxFlips ?? Infinity) : 0;
  if (n === 0 || kmin > kmax) return { numbers: n, log10Combos: -Infinity, log10Work: -Infinity, seconds: 0, coincidences: o.target === null ? null : 0 };

  // How many sums there are: Σ_j C(n, j) · (ways to pick up to fcap negatives among j).
  const logSigns = (j: number): number => {
    if (!flips) return 0;
    if (fcap >= j) return j * Math.log10(2);
    let t = -Infinity;
    let c = 0;
    for (let i = 0; i <= fcap; i++) {
      if (i > 0) c += Math.log10(j - i + 1) - Math.log10(i);
      t = logAdd(t, c);
    }
    return t;
  };
  let logCombos = -Infinity;
  let lc = 0;
  for (let j = 1; j <= kmax; j++) {
    lc += Math.log10(n - j + 1) - Math.log10(j);
    if (j >= kmin) logCombos = logAdd(logCombos, lc + logSigns(j));
  }

  // Work, tier by tier, the way the engine does it.
  const entries = flips ? [...vals, ...vals.map(v => -v)] : vals;
  const M = entries.length;
  const muE = meanOf(entries);
  const sdE = sdOf(entries, muE);
  let maxE = -Infinity;
  let minE = Infinity;
  for (const e of entries) { if (e > maxE) maxE = e; if (e < minE) minE = e; }
  const lo = (o.target ?? 0) - o.tolerance;
  const hi = (o.target ?? 0) + o.tolerance;
  let logW = -Infinity;
  if (kmin <= 1) logW = logAdd(logW, Math.log10(n));
  if (kmin <= 2 && kmax >= 2) logW = logAdd(logW, Math.log10(M));
  if (kmin <= 3 && kmax >= 3) logW = logAdd(logW, 2 * Math.log10(M));
  const top = Math.min(kmax, MAX_MODELED_SIZE);
  const logChooseM: number[] = [0];
  for (let d = 1; d <= top && d <= M; d++) logChooseM[d] = logChooseM[d - 1] + Math.log10(M - d + 1) - Math.log10(d);
  const positiveOnly = o.target !== null && minE > 0;
  const sorted = positiveOnly ? entries.slice().sort((a, b) => a - b) : [];
  /** How many entries are at most x. */
  const atMost = (x: number) => { let a = 0; let b = sorted.length; while (a < b) { const m = (a + b) >> 1; if (sorted[m] <= x) a = m + 1; else b = m; } return a; };
  for (let k = Math.max(4, kmin); k <= top; k++) {
    for (let d = 1; d < k && d <= M; d++) {
      const rem = k - d;
      let term = logChooseM[d];
      if (o.target !== null && sdE > 0) {
        // Partial sums of d entries that k − d more entries could still bring into [lo, hi].
        const s = Math.sqrt(d) * sdE;
        term += logBetween((lo - rem * maxE - d * muE) / s, (hi - rem * minE - d * muE) / s);
      }
      if (positiveOnly) {
        const c = atMost(hi / (rem + 1));
        term = Math.min(term, d <= c ? logChoose(c, d) : -Infinity);
      }
      logW = logAdd(logW, term);
    }
  }
  const logSec = logW - LOG_RATE;
  const seconds = logSec > 300 ? Infinity : 10 ** logSec;

  // Coincidences: sums of 2+ numbers landing within the window around the target by chance.
  let coincidences: number | null = null;
  if (o.target !== null) {
    const mean = meanOf(vals);
    const sd = sdOf(vals, mean);
    if (sd <= 0) {
      coincidences = 0;
    } else {
      const logWindow = Math.log10(Math.max(2 * o.tolerance, 0.01));
      let logE = -Infinity;
      for (let j = Math.max(2, kmin); j <= top; j++) {
        const sdj = Math.sqrt(j) * sd;
        const base = logChoose(n, j) + logWindow - Math.log10(sdj) - LOG_SQRT_2PI;
        let lci = 0; // log10 C(j, i)
        for (let i = 0; i <= Math.min(j, fcap); i++) {
          if (i > 0) lci += Math.log10(j - i + 1) - Math.log10(i);
          const z = (o.target - (j - 2 * i) * mean) / sdj;
          logE = logAdd(logE, base + lci - (z * z / 2) * LOG_E);
        }
      }
      coincidences = logE > 300 ? Infinity : 10 ** logE;
    }
  }
  return { numbers: n, log10Combos: logCombos, log10Work: logW, seconds, coincidences };
}

/** "under a second", "about 40 seconds", "about 3 hours", "about 12 days", "longer than a lifetime". */
export function durationPhrase(seconds: number): string {
  if (seconds < 1) return 'under a second';
  if (seconds < 90) return `about ${Math.round(seconds)} seconds`;
  if (seconds < 90 * 60) return `about ${Math.round(seconds / 60)} minutes`;
  if (seconds < 48 * 3600) return `about ${Math.round(seconds / 3600)} hours`;
  if (seconds < 2 * 365 * 86400) return `about ${Math.round(seconds / 86400)} days`;
  return 'longer than a lifetime';
}

/** "a sum or two may add up to 3,235 by coincidence" … "expect many sums to add up to 3,235 by coincidence, so a match alone proves little". */
export function coincidencePhrase(expected: number, what: string): string {
  if (expected < 3) return `a sum or two may add up to ${what} by coincidence`;
  if (expected < 30) return `expect several sums to add up to ${what} by coincidence`;
  return `expect many sums to add up to ${what} by coincidence, so a match alone proves little`;
}
