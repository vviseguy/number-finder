// Calibrates the size estimate (src/lib/estimate.ts) against the real engine: runs searches that can't
// match exactly (so every sum is tried or pruned), times them, and prints the work units per second.
// RATE in estimate.ts should sit at or below the slowest rate seen here. Run: node scripts/bench-engine.mts
import { runSearch } from '../src/engine/search.ts';
import { estimateSearch, RATE } from '../src/lib/estimate.ts';

function rand(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; }; }
/** Uniform 0–10,000, or tax-like: log-uniform 10–100,000, some whole dollars, some with cents. */
function values(n: number, seed: number, taxLike: boolean): number[] {
  const r = rand(seed);
  return Array.from({ length: n }, () => {
    if (!taxLike) return Math.round(r() * 1_000_000) / 100;
    const v = 10 ** (1 + r() * 4);
    return r() < 0.5 ? Math.round(v) : Math.round(v * 100) / 100;
  });
}

const cases: { n: number; k: number | null; flips: boolean; tax: boolean; target?: number }[] = [
  { n: 150, k: 4, flips: false, tax: false }, { n: 300, k: 4, flips: false, tax: false }, { n: 200, k: 5, flips: false, tax: false },
  { n: 60, k: 6, flips: false, tax: false }, { n: 100, k: 4, flips: true, tax: false }, { n: 60, k: 5, flips: true, tax: false },
  { n: 29, k: null, flips: false, tax: true, target: 12_345.671 }, { n: 40, k: null, flips: false, tax: true, target: 12_345.671 },
  { n: 60, k: 5, flips: false, tax: true, target: 90_234.561 }, { n: 120, k: 4, flips: true, tax: true, target: 90_234.561 },
  { n: 60, k: null, flips: false, tax: true, target: 12_345.671 }, { n: 60, k: null, flips: false, tax: true, target: 150_234.561 },
  { n: 22, k: null, flips: true, tax: true, target: 12_345.671 },
];
for (const c of cases) {
  const vals = values(c.n, c.n * 7 + (c.k ?? 99), c.tax);
  const target = c.target ?? Math.round((vals.reduce((s, v) => s + v, 0) / c.n) * (c.k ?? 3) * 100) / 100 + 0.001;
  const t0 = performance.now();
  const ev = runSearch({
    target, maxCount: c.k, allowFlips: c.flips, tolerance: 0, maxResults: 1e9, timeLimitMs: 15_000, limits: {},
    candidates: vals.map((value, i) => ({ id: `c${i}`, fileId: `f${i % 3}`, value })),
  });
  const ms = performance.now() - t0;
  const done = ev.find(e => e.type === 'done');
  const est = estimateSearch({ values: vals, target, maxCount: c.k, allowFlips: c.flips, tolerance: 0 });
  const rate = 10 ** est.log10Work / (ms / 1000);
  console.log(`${c.tax ? 'tax' : 'uni'} n=${c.n} k=${c.k ?? 'any'} flips=${c.flips}: engine ${(ms / 1000).toFixed(2)} s (${done && done.type === 'done' ? done.reason : '?'}), estimate ${est.seconds.toExponential(2)} s, units/s ${rate.toExponential(2)} (RATE ${RATE.toExponential(0)})`);
}
