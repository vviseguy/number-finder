// Near misses: the number a person most likely meant when nothing matches.
//
// Contract:
//   - A TRANSPOSITION (two adjacent digits swapped: 9,120 vs 9,102) is the classic data-entry error,
//     so it beats plain closeness. Digits are compared at the target's precision: a whole-dollar target
//     is compared with each candidate rounded to dollars (3,253 vs 3,234.56 → "3253" vs "3235").
//   - Otherwise a candidate within 2% of the target (and at least $1) is "close".
//   - Anything farther is not reported: "nearest" numbers that are far off are noise, not leads.
//   - Exact matches (within half a cent) are never near misses.

export interface NearMiss<T> {
  item: T;
  /** The candidate's value as compared (negated when a flip was allowed and closer). */
  value: number;
  sign: 1 | -1;
  /** value − target */
  diff: number;
  transposed: boolean;
}

export const CLOSE_RATIO = 0.02;

function digits(n: number, decimals: number): string {
  return Math.abs(decimals === 0 ? Math.round(n) : Math.round(n * 100)).toString();
}

export function isTransposition(target: number, value: number, targetDecimals: number): boolean {
  if (target !== 0 && value !== 0 && Math.sign(target) !== Math.sign(value)) return false;
  const a = digits(target, targetDecimals);
  const b = digits(value, targetDecimals);
  if (a.length !== b.length || a === b) return false;
  const at: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) at.push(i);
  return at.length === 2 && at[1] === at[0] + 1 && a[at[0]] === b[at[1]] && a[at[1]] === b[at[0]];
}

export function findNearMiss<T>(
  target: number,
  targetDecimals: number,
  items: T[],
  valueOf: (item: T) => number,
  allowFlips = false,
): NearMiss<T> | null {
  let best: NearMiss<T> | null = null;
  const limit = Math.max(1, Math.abs(target) * CLOSE_RATIO);
  for (const item of items) {
    const raw = valueOf(item);
    for (const sign of allowFlips ? ([1, -1] as const) : ([1] as const)) {
      const value = sign * raw;
      const diff = value - target;
      if (Math.abs(diff) < 0.005) continue;
      const transposed = isTransposition(target, value, targetDecimals);
      if (!transposed && Math.abs(diff) > limit) continue;
      const better = !best
        || (transposed && !best.transposed)
        || (transposed === best.transposed && Math.abs(diff) < Math.abs(best.diff));
      if (better) best = { item, value, sign, diff, transposed };
    }
  }
  return best;
}
