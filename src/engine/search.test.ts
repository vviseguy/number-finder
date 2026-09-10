import { describe, expect, it } from 'vitest';
import { createSearch, runSearch, validateRequest, decimalsOf } from './search';
import type { Candidate, EngineEvent, Match, SearchRequest } from '../types';

type DoneEvent = Extract<EngineEvent, { type: 'done' }>;

function req(p: Partial<SearchRequest> & { candidates: Candidate[]; target: number }): SearchRequest {
  return { maxCount: 1, allowFlips: false, tolerance: 0, limits: {}, maxResults: 10_000, timeLimitMs: 20_000, ...p };
}

function doneOf(events: EngineEvent[]): DoneEvent {
  const dones = events.filter((e): e is DoneEvent => e.type === 'done');
  expect(dones).toHaveLength(1);
  expect(events[events.length - 1]).toBe(dones[0]);
  return dones[0];
}

function search(r: SearchRequest): DoneEvent {
  return doneOf(runSearch(r));
}

const key = (m: Match) => m.items.map((i) => `${i.sign < 0 ? '-' : '+'}${i.id}`).join(' ');
const keys = (d: DoneEvent) => d.matches.map(key);

let _uid = 0;
function c(value: number, fileId = 'f', id?: string): Candidate {
  return { id: id ?? `${fileId}:${_uid++}`, fileId, value };
}

/** Seeded PRNG (mulberry32). */
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

// ── independent reference: brute force over every subset and sign pattern (values in cents) ──

interface Ref {
  key: string;
  k: number;
  adiff: number;
  flips: number;
  order: number[];
}

function compareRef(a: Ref, b: Ref): number {
  if (a.k !== b.k) return a.k - b.k;
  if (a.adiff !== b.adiff) return a.adiff - b.adiff;
  if (a.flips !== b.flips) return a.flips - b.flips;
  for (let j = 0; j < a.k; j++) if (a.order[j] !== b.order[j]) return a.order[j] - b.order[j];
  return 0;
}

function refOf(r: SearchRequest, m: Match): Ref {
  const pos = new Map(r.candidates.map((x, i) => [x.id, i]));
  const val = new Map(r.candidates.map((x) => [x.id, Math.round(x.value * 100)]));
  const sum = m.items.reduce((s, it) => s + it.sign * (val.get(it.id) as number), 0);
  return {
    key: key(m),
    k: m.items.length,
    adiff: Math.abs(sum - Math.round(r.target * 100)),
    flips: m.items.filter((i) => i.sign < 0).length,
    order: m.items.map((i) => pos.get(i.id) as number),
  };
}

function brute(r: SearchRequest): Ref[] {
  const n = r.candidates.length;
  const v = r.candidates.map((x) => Math.round(x.value * 100));
  const T = Math.round(r.target * 100);
  const tol = Math.round(r.tolerance * 100);
  const kmax = Math.min(r.maxCount ?? n, n);
  const near0 = (s: number) => Math.abs(s) <= tol;
  const out: Ref[] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const items: number[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) items.push(i);
    const k = items.length;
    if (k > kmax) continue;
    const cnt = new Map<string, number>();
    for (const i of items) cnt.set(r.candidates[i].fileId, (cnt.get(r.candidates[i].fileId) ?? 0) + 1);
    let ok = true;
    for (const [fid, lim] of Object.entries(r.limits)) {
      const x = cnt.get(fid) ?? 0;
      if (x < lim.min || (lim.max !== null && x > lim.max)) ok = false;
    }
    if (!ok) continue;
    const push = (signs: number[], sum: number) =>
      out.push({
        key: items.map((i, j) => `${signs[j] < 0 ? '-' : '+'}${r.candidates[i].id}`).join(' '),
        k,
        adiff: Math.abs(sum - T),
        flips: signs.filter((s) => s < 0).length,
        order: items,
      });
    if (k === 1) {
      const x = v[items[0]];
      if (Math.abs(x - T) <= tol) push([1], x);
      else if (r.allowFlips && Math.abs(-x - T) <= tol) push([-1], -x);
      continue;
    }
    if (items.some((i) => near0(v[i]))) continue;
    const patterns = r.allowFlips ? 1 << k : 1;
    for (let sp = 0; sp < patterns; sp++) {
      const signs = items.map((_, j) => (sp & (1 << j) ? -1 : 1));
      const sv = items.map((i, j) => signs[j] * v[i]);
      const sum = sv.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - T) > tol) continue;
      let minimal = true;
      for (let sub = 1; sub < (1 << k) - 1 && minimal; sub++) {
        const size = popcount(sub);
        if (k > 12 && size > 2) continue;
        let s = 0;
        for (let j = 0; j < k; j++) if (sub & (1 << j)) s += sv[j];
        if (near0(s)) minimal = false;
      }
      if (minimal) push(signs, sum);
    }
  }
  return out.sort(compareRef);
}

function popcount(x: number): number {
  let c2 = 0;
  while (x) {
    x &= x - 1;
    c2++;
  }
  return c2;
}

/** Every reported match obeys the documented rules. */
function expectValid(r: SearchRequest, d: DoneEvent): void {
  const val = new Map(r.candidates.map((x) => [x.id, x.value]));
  const tolC = Math.round(r.tolerance * 100);
  for (const m of d.matches) {
    const ids = m.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    if (r.maxCount !== null) expect(ids.length).toBeLessThanOrEqual(r.maxCount);
    if (!r.allowFlips) expect(m.items.every((i) => i.sign === 1)).toBe(true);
    const sv = m.items.map((i) => Math.round(i.sign * (val.get(i.id) as number) * 100));
    const sum = sv.reduce((a, b) => a + b, 0);
    expect(Math.round(m.sum * 100)).toBe(sum);
    expect(Math.round(m.diff * 100)).toBe(sum - Math.round(r.target * 100));
    expect(Math.abs(sum - Math.round(r.target * 100))).toBeLessThanOrEqual(tolC);
    if (sv.length > 1) {
      for (let a = 0; a < sv.length; a++) {
        expect(Math.abs(sv[a])).toBeGreaterThan(tolC);
        for (let b = a + 1; b < sv.length; b++) if (sv.length > 2) expect(Math.abs(sv[a] + sv[b])).toBeGreaterThan(tolC);
      }
    }
  }
  const refs = d.matches.map((m) => refOf(r, m));
  for (let i = 1; i < refs.length; i++) expect(compareRef(refs[i - 1], refs[i])).toBeLessThanOrEqual(0);
  expect(new Set(refs.map((x) => x.key)).size).toBe(refs.length);
}

// ─────────────────────────────────────────────────────────────── tests

describe('decimals and validation', () => {
  it('reads decimal places without strings', () => {
    expect(decimalsOf(3235)).toBe(0);
    expect(decimalsOf(3234.56)).toBe(2);
    expect(decimalsOf(0.1)).toBe(1);
    expect(decimalsOf(1.005)).toBe(3);
    expect(decimalsOf(-265.44)).toBe(2);
    expect(decimalsOf(1 / 3)).toBe(6);
  });

  it.each<[string, Partial<SearchRequest>]>([
    ['maxCount 0', { maxCount: 0 }],
    ['maxCount 1.5', { maxCount: 1.5 }],
    ['NaN target', { target: NaN }],
    ['negative tolerance', { tolerance: -0.01 }],
    ['min > max', { limits: { w2: { min: 3, max: 1 } } }],
    ['maxResults 0', { maxResults: 0 }],
  ])('rejects %s with a readable detail', (_name, patch) => {
    const r = { ...req({ candidates: [c(1, 'w2')], target: 1 }), ...patch };
    expect(validateRequest(r)).toMatch(/\w+/);
    const s = createSearch(r);
    expect(s.done).toBe(false);
    const events = s.step(10);
    expect(events).toHaveLength(1);
    const d = doneOf(events);
    expect(d.reason).toBe('invalid');
    expect(d.detail).toMatch(/[a-z]{3}/);
    expect(d.matches).toEqual([]);
    expect(d.nearest).toBeNull();
    expect(s.done).toBe(true);
    expect(s.step(10)).toEqual([]);
  });

  it('treats empty candidates as exhausted with no nearest', () => {
    const d = search(req({ candidates: [], target: 3235, maxCount: null }));
    expect(d.reason).toBe('exhausted');
    expect(d.matches).toEqual([]);
    expect(d.nearest).toBeNull();
  });
});

describe('exact lookup (maxCount 1)', () => {
  const cands = [
    c(52340.12, 'w2', 'w2:box1'),
    c(3234.56, 'w2', 'w2:box2'),
    c(812.33, 'int', 'int:box1'),
    c(3234.56, 'int', 'int:box4'),
    c(9102.0, 'k1', 'k1:line1'),
    c(3235, 'return', '1040:25a'),
  ];

  it('returns every hit in input order', () => {
    const d = search(req({ candidates: cands, target: 3234.56 }));
    expect(d.reason).toBe('exhausted');
    expect(keys(d)).toEqual(['+w2:box2', '+int:box4']);
    expect(d.matches[0]).toEqual({ items: [{ id: 'w2:box2', sign: 1 }], sum: 3234.56, diff: 0 });
    expect(d.nearest).toBeNull();
  });

  it('whole-dollar rounding: 3,234.56 matches 3,235 within 0.5', () => {
    const d = search(req({ candidates: cands, target: 3235, tolerance: 0.5 }));
    expect(keys(d)).toEqual(['+1040:25a', '+w2:box2', '+int:box4']);
    expect(d.matches[1].diff).toBe(-0.44);
    expect(search(req({ candidates: cands, target: 3235, tolerance: 0 })).matches.map(key)).toEqual(['+1040:25a']);
  });

  it('cent tolerance: 0.01 either way, no further', () => {
    expect(keys(search(req({ candidates: cands, target: 3234.57, tolerance: 0.01 })))).toEqual(['+w2:box2', '+int:box4']);
    expect(keys(search(req({ candidates: cands, target: 3234.55, tolerance: 0.01 })))).toEqual(['+w2:box2', '+int:box4']);
    expect(keys(search(req({ candidates: cands, target: 3234.58, tolerance: 0.01 })))).toEqual([]);
  });

  it('is exact where floats are not (0.1 + 0.2 = 0.3)', () => {
    const d = search(req({ candidates: [c(0.1, 'a', 'a'), c(0.2, 'b', 'b')], target: 0.3, maxCount: 2 }));
    expect(keys(d)).toEqual(['+a +b']);
    expect(d.matches[0].sum).toBe(0.3);
    expect(d.matches[0].diff).toBe(0);
  });
});

describe('flips', () => {
  const k1 = [c(1200, 'k1', 'k1:a'), c(-265.44, 'k1', 'k1:loss')];

  it('finds −265.44 for 265.44 only with allowFlips', () => {
    expect(search(req({ candidates: k1, target: 265.44 })).matches).toEqual([]);
    const d = search(req({ candidates: k1, target: 265.44, allowFlips: true }));
    expect(d.matches).toEqual([{ items: [{ id: 'k1:loss', sign: -1 }], sum: 265.44, diff: 0 }]);
  });

  it('3,500.00 − 265.44 = 3,234.56 with maxCount 2', () => {
    const cands = [c(3500, 'w2', 'w2:box1'), c(265.44, 'int', 'int:box1'), c(18.07, 'int', 'int:box2')];
    expect(search(req({ candidates: cands, target: 3234.56, maxCount: 2 })).matches).toEqual([]);
    const d = search(req({ candidates: cands, target: 3234.56, maxCount: 2, allowFlips: true }));
    expect(keys(d)).toEqual(['+w2:box1 -int:box1']);
    expect(d.matches[0].sum).toBe(3234.56);
  });

  it('a single number is reported once, with + when both signs fit', () => {
    const d = search(req({ candidates: [c(0.3, 'a', 'a')], target: 0, tolerance: 0.5, allowFlips: true }));
    expect(keys(d)).toEqual(['+a']);
  });
});

describe('combinations', () => {
  it('2-sums: 812.33 + 1,410.07 = 2,222.40', () => {
    const cands = [c(812.33, 'int', 'int:1'), c(99.95, 'div', 'div:2'), c(1410.07, 'div', 'div:1a'), c(52340.12, 'w2', 'w2:1')];
    const r = req({ candidates: cands, target: 2222.4, maxCount: 2 });
    const d = search(r);
    expect(keys(d)).toEqual(['+int:1 +div:1a']);
    expectValid(r, d);
  });

  it('3-sums: 1,200.00 + 845.50 + 99.95 = 2,145.45', () => {
    const cands = [c(1200, 'a', 'a'), c(3.5, 'a', 'x'), c(845.5, 'b', 'b'), c(7000, 'b', 'y'), c(99.95, 'c', 'c')];
    const r = req({ candidates: cands, target: 2145.45, maxCount: 3 });
    expect(keys(search(r))).toEqual(['+a +b +c']);
    expect(search({ ...r, maxCount: 2 }).matches).toEqual([]);
  });

  it('any count (DFS): four estimated payments of 1,250 plus 480.25', () => {
    const cands = [
      c(1250, 'est', 'q1'),
      c(52340.12, 'w2', 'w2:1'),
      c(1250, 'est', 'q2'),
      c(9102, 'k1', 'k1:1'),
      c(1250, 'est', 'q3'),
      c(17.89, 'int', 'int:1'),
      c(1250, 'est', 'q4'),
      c(480.25, 'st', 'state'),
      c(3234.56, 'w2', 'w2:2'),
    ];
    const r = req({ candidates: cands, target: 5480.25, maxCount: null });
    const d = search(r);
    expect(d.reason).toBe('exhausted');
    expect(keys(d)).toContain('+q1 +q2 +q3 +q4 +state');
    expectValid(r, d);
    expect(keys(search({ ...r, maxCount: 4 }))).not.toContain('+q1 +q2 +q3 +q4 +state');
  });

  it('agrees with brute force on random small sets (flips, tolerance, limits, zeros, cancel pairs)', () => {
    const rand = rng(20260910);
    const files = ['w2', 'int', 'k1'];
    for (let trial = 0; trial < 140; trial++) {
      const n = 5 + Math.floor(rand() * 4);
      const cands: Candidate[] = [];
      for (let i = 0; i < n; i++) {
        const roll = rand();
        let value: number;
        if (roll < 0.08) value = 0;
        else if (roll < 0.2 && cands.length > 0) value = -cands[Math.floor(rand() * cands.length)].value;
        else if (roll < 0.3 && cands.length > 0) value = cands[Math.floor(rand() * cands.length)].value;
        else value = Math.round((rand() * 400 - 100) * (rand() < 0.5 ? 1 : 100)) / 100;
        cands.push({ id: `c${i}`, fileId: files[Math.floor(rand() * files.length)], value });
      }
      const subset = cands.filter(() => rand() < 0.45);
      const target = Math.round(subset.reduce((s, x) => s + (rand() < 0.3 ? -x.value : x.value), 0) * 100) / 100;
      const maxCount = [1, 2, 3, 4, 5, null][Math.floor(rand() * 6)];
      const tolerance = [0, 0, 0.01, 0.5, 3][Math.floor(rand() * 5)];
      const limits: SearchRequest['limits'] = {};
      const lroll = rand();
      if (lroll < 0.2) limits.w2 = { min: 1, max: null };
      else if (lroll < 0.35) limits.int = { min: 0, max: 1 };
      else if (lroll < 0.45) limits.k1 = { min: 0, max: 0 };
      else if (lroll < 0.55) limits.w2 = { min: 1, max: 2 };
      const r = req({ candidates: cands, target, maxCount, tolerance, limits, allowFlips: rand() < 0.5 });
      const d = search(r);
      expect(d.reason, JSON.stringify(r)).toBe('exhausted');
      const expected = brute(r);
      expect(new Set(keys(d)), JSON.stringify(r)).toEqual(new Set(expected.map((x) => x.key)));
      expect(d.matches.length, JSON.stringify(r)).toBe(expected.length);
      expectValid(r, d);
    }
  });
});

describe('per-file limits', () => {
  const cands = [
    c(812.33, 'int', 'int:1'),
    c(1000, 'w2', 'w2:a'),
    c(1410.07, 'div', 'div:1'),
    c(1222.4, 'w2', 'w2:b'),
    c(612.33, 'div', 'div:2'),
    c(200, 'int', 'int:2'),
  ];
  const base = req({ candidates: cands, target: 2222.4, maxCount: 3 });

  it('without limits finds all three ways to 2,222.40 (items listed in input order)', () => {
    const d = search(base);
    expect(keys(d)).toEqual(['+int:1 +div:1', '+w2:a +w2:b', '+div:1 +div:2 +int:2']);
    expectValid(base, d);
  });

  it('max caps a file; max 0 removes it', () => {
    expect(keys(search({ ...base, limits: { w2: { min: 0, max: 1 } } }))).toEqual(['+int:1 +div:1', '+div:1 +div:2 +int:2']);
    expect(keys(search({ ...base, limits: { div: { min: 0, max: 1 } } }))).toEqual(['+int:1 +div:1', '+w2:a +w2:b']);
    expect(keys(search({ ...base, limits: { int: { min: 0, max: 0 } } }))).toEqual(['+w2:a +w2:b']);
  });

  it('min 1 forces inclusion', () => {
    expect(keys(search({ ...base, limits: { w2: { min: 1, max: null } } }))).toEqual(['+w2:a +w2:b']);
    expect(keys(search({ ...base, limits: { div: { min: 2, max: null } } }))).toEqual(['+div:1 +div:2 +int:2']);
    const r = { ...base, maxCount: null, limits: { int: { min: 1, max: null } } };
    const d = search(r);
    expect(keys(d)).toEqual(['+int:1 +div:1', '+div:1 +div:2 +int:2']);
  });

  it('a required file with no numbers means no match', () => {
    const d = search({ ...base, limits: { missing: { min: 1, max: null } } });
    expect(d.reason).toBe('exhausted');
    expect(d.matches).toEqual([]);
  });
});

describe('minimality', () => {
  it('never uses zeros or canceling pairs', () => {
    const cands = [
      c(3235, 'return', 'r:25a'),
      c(100, 'w2', 'w2:a'),
      c(-100, 'k1', 'k1:a'),
      c(0, 'w2', 'w2:zero'),
      c(0.3, 'w2', 'w2:tiny'),
      c(2985, 'int', 'int:a'),
      c(250, 'int', 'int:b'),
      c(3135, 'k1', 'k1:b'),
    ];
    for (const allowFlips of [false, true]) {
      for (const maxCount of [2, 3, 4, 6, null]) {
        const r = req({ candidates: cands, target: 3235, tolerance: 0.5, maxCount, allowFlips });
        const d = search(r);
        expectValid(r, d);
        expect(keys(d)[0]).toBe('+r:25a');
        for (const m of d.matches) {
          if (m.items.length > 1) {
            expect(m.items.map((i) => i.id)).not.toContain('w2:zero');
            expect(m.items.map((i) => i.id)).not.toContain('w2:tiny');
            expect(m.items.map((i) => i.id)).not.toContain('r:25a');
          }
        }
        expect(keys(d)).not.toContain('+w2:a +k1:a +r:25a');
        expect(new Set(keys(d))).toEqual(new Set(brute(r).map((x) => x.key)));
      }
    }
  });
});

describe('ordering, limits on results, stopping', () => {
  it('orders by count, |diff|, flips, then input order', () => {
    const cands = [
      c(600, 'a', 'p600'),
      c(999.7, 'a', 'near'),
      c(-1000, 'b', 'neg'),
      c(400, 'b', 'p400'),
      c(1000, 'c', 'exact'),
      c(-400, 'c', 'n400'),
    ];
    const r = req({ candidates: cands, target: 1000, tolerance: 0.5, maxCount: 2, allowFlips: true });
    const d = search(r);
    expect(keys(d).slice(0, 3)).toEqual(['+exact', '-neg', '+near']);
    expect(keys(d)).toContain('+p600 +p400');
    expect(keys(d)).toContain('+p600 -n400');
    expect(keys(d).indexOf('+p600 +p400')).toBeLessThan(keys(d).indexOf('+p600 -n400'));
    expectValid(r, d);
  });

  it('stops at maxResults', () => {
    const cands = Array.from({ length: 40 }, (_, i) => c(100, `f${i % 3}`, `h${i}`));
    const r = req({ candidates: cands, target: 300, maxCount: 3, maxResults: 5 });
    const events = runSearch(r);
    const d = doneOf(events);
    expect(d.reason).toBe('maxResults');
    expect(d.matches).toHaveLength(5);
    expect(events.filter((e) => e.type === 'match')).toHaveLength(5);
    expectValid(r, d);
  });

  it('stops at timeLimit', () => {
    // Every value is an even number of cents and the target is odd: nothing can ever match.
    const rand = rng(7);
    const cands = Array.from({ length: 80 }, (_, i) => c(Math.floor(rand() * 500000) * 0.02, 'f', `e${i}`));
    const r = req({ candidates: cands, target: 12345.67, maxCount: null, allowFlips: true, timeLimitMs: 150 });
    const t0 = performance.now();
    const events = runSearch(r, 20);
    const took = performance.now() - t0;
    const d = doneOf(events);
    expect(d.reason).toBe('timeLimit');
    expect(took).toBeGreaterThanOrEqual(140);
    expect(took).toBeLessThan(400);
    expect(d.nearest).not.toBeNull();
    expect(events.some((e) => e.type === 'progress' && e.fraction === null)).toBe(true);
  });

  it('stop(): the next step returns done with the matches so far', () => {
    const rand = rng(11);
    const cands = Array.from({ length: 300 }, (_, i) => c(Math.round(rand() * 2000000) / 100, 'f', `s${i}`));
    const target = cands[3].value + cands[50].value + cands[77].value + cands[123].value + cands[200].value + cands[299].value;
    const s = createSearch(req({ candidates: cands, target, maxCount: null, allowFlips: true, tolerance: 0.5 }));
    const first = s.step(15);
    expect(s.done).toBe(false);
    const found = first.filter((e) => e.type === 'match').length;
    s.stop();
    expect(s.done).toBe(false);
    const after = s.step(30);
    expect(after).toHaveLength(1);
    const d = doneOf(after);
    expect(d.reason).toBe('stopped');
    expect(d.matches).toHaveLength(found);
    expect(s.done).toBe(true);
    expect(s.step(30)).toEqual([]);
    s.stop(); // no-op after done
    expect(s.step(30)).toEqual([]);
  });

  it('stop() before the first step still reports nearest', () => {
    const s = createSearch(req({ candidates: [c(9102, 'k1', 'k1:1')], target: 9120 }));
    s.stop();
    const d = doneOf(s.step(10));
    expect(d.reason).toBe('stopped');
    expect(d.nearest).toEqual({ id: 'k1:1', sign: 1, diff: -18 });
  });

  it('reports a known progress fraction for maxCount ≤ 3', () => {
    const rand = rng(3);
    const cands = Array.from({ length: 5000 }, (_, i) => c(Math.floor(rand() * 5000000) * 0.02, `f${i % 4}`, `p${i}`));
    const r = req({ candidates: cands, target: 33333.33, maxCount: 3, allowFlips: true });
    const events = runSearch(r, 10);
    const fractions = events.flatMap((e) => (e.type === 'progress' ? [e.fraction] : []));
    expect(fractions.length).toBeGreaterThan(0);
    for (const f of fractions) {
      expect(f).not.toBeNull();
      expect(f as number).toBeGreaterThan(0);
      expect(f as number).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < fractions.length; i++) expect(fractions[i] as number).toBeGreaterThanOrEqual(fractions[i - 1] as number);
    expect(doneOf(events).reason).toBe('exhausted');
  }, 20_000);
});

describe('nearest', () => {
  const cands = [c(52340.12, 'w2', 'w2:1'), c(9102, 'k1', 'k1:1'), c(-9119, 'k1', 'k1:neg'), c(9140, 'int', 'int:1')];

  it('9,120 → 9,102.00 with diff −18 (flips off ignores −9,119)', () => {
    const d = search(req({ candidates: cands, target: 9120 }));
    expect(d.matches).toEqual([]);
    expect(d.nearest).toEqual({ id: 'k1:1', sign: 1, diff: -18 });
  });

  it('uses the flipped sign only with allowFlips; ties go to the earliest', () => {
    expect(search(req({ candidates: cands, target: 9120, allowFlips: true })).nearest).toEqual({ id: 'k1:neg', sign: -1, diff: -1 });
    expect(search(req({ candidates: [c(9100, 'a', 'a'), c(9140, 'b', 'b')], target: 9120 })).nearest).toEqual({ id: 'a', sign: 1, diff: -20 });
  });

  it('is null when anything matched', () => {
    expect(search(req({ candidates: cands, target: 9102 })).nearest).toBeNull();
  });
});

describe('step budget', () => {
  function randomTaxValues(n: number, seed: number, evenCents = false): Candidate[] {
    const rand = rng(seed);
    const out: Candidate[] = [];
    for (let i = 0; i < n; i++) {
      const roll = rand();
      let v: number;
      if (roll < 0.25) v = Math.round(rand() * 20000); // whole dollars
      else if (roll < 0.85) v = Math.round(rand() * 2500000) / 100;
      else if (roll < 0.95) v = -Math.round(rand() * 500000) / 100;
      else v = Math.round(rand() * 25000000) / 100;
      if (evenCents) v = Math.round(v * 50) / 50;
      out.push(c(v, `file${i % 5}`, `b${seed}:${i}`));
    }
    return out;
  }

  function maxStep(r: SearchRequest): { longest: number; done: DoneEvent } {
    const s = createSearch(r);
    let longest = 0;
    const events: EngineEvent[] = [];
    while (!s.done) {
      const t0 = performance.now();
      events.push(...s.step(30));
      longest = Math.max(longest, performance.now() - t0);
    }
    return { longest, done: doneOf(events) };
  }

  it('2,000 candidates, maxCount null, flips on: no step over 60 ms', () => {
    const cands = randomTaxValues(2000, 99);
    const target = Math.round((cands[5].value - cands[900].value + cands[1400].value + cands[1999].value + cands[42].value) * 100) / 100;
    const { longest, done } = maxStep(req({ candidates: cands, target, maxCount: null, allowFlips: true, maxResults: 300, timeLimitMs: 1500 }));
    expect(longest).toBeLessThan(60);
    expect(done.matches.length).toBeGreaterThan(0);
  }, 20_000);

  it('same with no possible match (full tiers 1–3, then DFS until the time limit)', () => {
    const cands = randomTaxValues(2000, 5, true);
    const { longest, done } = maxStep(req({ candidates: cands, target: 12345.67, maxCount: null, allowFlips: true, timeLimitMs: 1500 }));
    expect(longest).toBeLessThan(60);
    expect(done.reason).toBe('timeLimit');
    expect(done.nearest).not.toBeNull();
  }, 20_000);
});
