// Search engine benchmark: time-to-first-match on 2,000 tax-like candidates.
//
//   Run:  node src/engine/bench.ts        (Node ≥ 23.6 strips the types itself; this repo uses Node 24)
//
// For each maxCount (1, 2, 3, any) and flips off/on, the target is built from real candidates so a
// match exists (1, 2, 3 or 6 of them; some negated when flips are on). A second table times a full
// scan when NO match can exist (every value an even number of cents, target odd).

import { createSearch } from './search.ts';
import type { Candidate, EngineEvent, SearchRequest } from '../types.ts';

const N = 2000;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function candidates(seed: number, evenCents: boolean): Candidate[] {
  const rand = rng(seed);
  const out: Candidate[] = [];
  for (let i = 0; i < N; i++) {
    const roll = rand();
    let v: number;
    if (roll < 0.25) v = Math.round(rand() * 20000);
    else if (roll < 0.85) v = Math.round(rand() * 2500000) / 100;
    else if (roll < 0.95) v = -Math.round(rand() * 500000) / 100;
    else v = Math.round(rand() * 25000000) / 100;
    if (evenCents) v = Math.round(v * 50) / 50;
    out.push({ id: `c${i}`, fileId: `file${i % 6}`, value: v });
  }
  return out;
}

interface Result {
  firstMs: number | null;
  totalMs: number;
  found: number;
  reason: string;
}

function time(req: SearchRequest): Result {
  const s = createSearch(req);
  const t0 = performance.now();
  let firstMs: number | null = null;
  let done: Extract<EngineEvent, { type: 'done' }> | null = null;
  while (!s.done) {
    for (const e of s.step(30)) {
      if (e.type === 'match' && firstMs === null) firstMs = performance.now() - t0;
      if (e.type === 'done') done = e;
    }
  }
  const d = done as Extract<EngineEvent, { type: 'done' }>;
  return { firstMs, totalMs: performance.now() - t0, found: d.matches.length, reason: d.reason };
}

const fmt = (ms: number | null) => (ms === null ? '—' : ms < 1 ? `${ms.toFixed(2)} ms` : `${ms.toFixed(1)} ms`);
const pad = (s: string, w: number) => s.padEnd(w);

const counts: (number | null)[] = [1, 2, 3, null];
console.log(`\nTime to first match, ${N} candidates (maxResults 50, time limit 10 s, tolerance 0)\n`);
console.log(`${pad('maxCount', 10)}${pad('flips', 7)}${pad('first match', 14)}${pad('done after', 14)}${pad('found', 7)}reason`);
let seed = 1;
for (const maxCount of counts) {
  for (const allowFlips of [false, true]) {
    const cands = candidates(seed++, false);
    const rand = rng(seed * 31);
    const k = maxCount ?? 6;
    const picked = new Set<number>();
    while (picked.size < k) picked.add(Math.floor(rand() * N));
    let target = 0;
    for (const i of picked) target += allowFlips && rand() < 0.4 ? -cands[i].value : cands[i].value;
    target = Math.round(target * 100) / 100;
    const r = time({ target, maxCount, allowFlips, tolerance: 0, candidates: cands, limits: {}, maxResults: 50, timeLimitMs: 10_000 });
    console.log(`${pad(String(maxCount ?? 'any'), 10)}${pad(allowFlips ? 'on' : 'off', 7)}${pad(fmt(r.firstMs), 14)}${pad(fmt(r.totalMs), 14)}${pad(String(r.found), 7)}${r.reason}`);
  }
}

console.log(`\nFull scan with no possible match, ${N} candidates\n`);
console.log(`${pad('maxCount', 10)}${pad('flips', 7)}${pad('done after', 14)}reason`);
for (const maxCount of [1, 2, 3]) {
  for (const allowFlips of [false, true]) {
    const cands = candidates(seed++, true);
    const r = time({ target: 12345.67, maxCount, allowFlips, tolerance: 0, candidates: cands, limits: {}, maxResults: 50, timeLimitMs: 10_000 });
    console.log(`${pad(String(maxCount), 10)}${pad(allowFlips ? 'on' : 'off', 7)}${pad(fmt(r.totalMs), 14)}${r.reason}`);
  }
}

// Burst of exact lookups like "Check a group": 500 searches, maxCount 1, run back to back.
{
  const cands = candidates(seed++, false);
  const t0 = performance.now();
  for (let i = 0; i < 500; i++) {
    const s = createSearch({ target: cands[i].value, maxCount: 1, allowFlips: true, tolerance: 0.5, candidates: cands, limits: {}, maxResults: 50, timeLimitMs: 10_000 });
    while (!s.done) s.step(50);
  }
  console.log(`\n500 exact lookups (maxCount 1) back to back: ${fmt(performance.now() - t0)} total\n`);
}
