/**
 * Number finder search engine: where does a number come from?
 *
 * Pure TypeScript: no DOM, no Worker globals, no runtime imports. Runs in Node tests, in a Web
 * Worker (worker.ts), and on the main thread (pool.ts runs exact lookups there).
 *
 * ── API ─────────────────────────────────────────────────────────────────────────────────
 *   createSearch(req) -> { step(budgetMs): EngineEvent[], stop(): void, done: boolean }
 *   validateRequest(req) -> string | null     (readable problem, or null when valid)
 *
 * step() works for about budgetMs and returns the events produced meanwhile. `done` turns true
 * once step() has RETURNED the 'done' event; after stop() (or for an invalid request) call
 * step() once more to receive it. step() after that returns [].
 *
 * ── Semantics ───────────────────────────────────────────────────────────────────────────
 * Exactness  d = max decimal places over every value, the target and the tolerance (cap 6;
 *            lowered only if the scaled magnitudes could pass 2^52). Everything is scaled by
 *            10^d and rounded half away from zero; all sums and comparisons use those integers.
 *            Floats appear only in the output (sum, diff), rounded to d decimals.
 * Match      1..maxCount DISTINCT candidates (maxCount null = any count), each with sign +1
 *            (or +1/-1 when allowFlips) and |Σ sign·value − target| ≤ tolerance.
 *            A single candidate is reported once: with + if +value matches, else with −.
 * File caps  For each fileId in req.limits the match holds between min and max items from that
 *            file (max null = no cap). max 0 removes the file's numbers entirely; min > 0 means
 *            every match includes at least `min` of that file's numbers. Unlisted files: no cap.
 * Minimal    Multi-item matches never contain a "zero" item (|value| ≤ tolerance), and no proper
 *            subset of the items may sum to within tolerance of 0. That is checked in full for
 *            matches of ≤ 12 items (2^k subset sums, only when a match is about to be reported);
 *            for 13+ items only single items and pairs are checked. So "3,235 + 100 − 100" and
 *            "3,235 + 2,985 + 250 − 3,135 − 100" never appear. (A 2-item match may cancel to ~0
 *            when the target itself is ~0: the pair is the whole match, not a proper subset.)
 * Order      Final `matches`: fewer items first, then smaller |diff|, then fewer flipped items,
 *            then earlier candidates (item input positions compared in ascending order).
 *            Items inside a match are listed in input order. 'match' events arrive in
 *            discovery order, which is by item count ascending.
 * Stopping   'maxResults' once maxResults matches are found (the first ones found, so by item
 *            count; not necessarily the best |diff| within the last count), 'timeLimit' after
 *            timeLimitMs of wall clock since the first step(), 'stopped' after stop(),
 *            'exhausted' when every combination was tried, 'invalid' for a bad request
 *            (detail = readable reason). Empty candidates is valid: exhausted, nearest null.
 * Nearest    When done with zero matches (any reason but 'invalid'): the single candidate
 *            minimizing |sign·value − target| (sign −1 only with allowFlips; ties → earliest
 *            candidate, then +). Candidates of a file with max 0 are skipped. Else null.
 * Events     'match' per match found; 'progress' about every 100 ms (fraction 0–1 when
 *            maxCount ≤ 3, else null); exactly one 'done' (matches sorted as above). The step
 *            that finds the search's FIRST match returns right away, so it shows up fast.
 *
 * ── Algorithm (tiers by item count, ascending) ─────────────────────────────────────────
 * 1 item     Linear scan in input order: O(n). Returns every hit (both signs with flips).
 * 2 items    "Signed entries" (value, and −value when allowFlips; zero items dropped) sorted
 *            ascending. For each entry p the partners q > p with E[q] in [lo − E[p], hi − E[p]]
 *            form a contiguous range whose ends only move left as p grows: O(N) two-pointer.
 * 3 items    For each p, the same two-pointer over (q, r) with E[q] + E[r] in the shifted
 *            window: O(N²) total plus output.
 * 4+ items   Size k = 4, 5, ... : resumable iterative DFS over the sorted entries (the Sum
 *            Finder subset enumerator): prefix-window lower bound (r smallest remaining) breaks
 *            a level at the first overshoot; a binary search skips entries that cannot reach
 *            the target even with the r−1 largest. Flips double the entries (−v and +v per
 *            item, at most one per item), so each item contributes −v, 0 or +v. File caps
 *            prune picks; a file minimum forces the remaining picks once they equal the deficit.
 * All loops count work and yield every 1,024 units; step() checks the clock between yields.
 */

import type { DoneReason, EngineEvent, Match, MatchItem, Nearest, SearchRequest } from '../types';

export interface Search {
  step(budgetMs: number): EngineEvent[];
  stop(): void;
  readonly done: boolean;
}

const CHUNK = 1024; // work units between clock checks
const PROGRESS_MS = 100;
const MAX_DECIMALS = 6;
const SAFE_MAGNITUDE = 2 ** 52;
const FULL_MINIMAL_MAX = 12; // matches up to this size get the full "no subset cancels" check

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

// ───────────────────────────────────────────────────────────────── numbers & validation

/** Decimal places of x's shortest round-trip form, capped at 6. No string conversion. */
export function decimalsOf(x: number): number {
  if (!Number.isFinite(x)) return 0;
  let p = 1;
  for (let k = 0; k < MAX_DECIMALS; k++, p *= 10) {
    if (Math.round(x * p) / p === x) return k;
  }
  return MAX_DECIMALS;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isCount = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;

/** Returns a readable description of the first problem, or null when the request is valid. */
export function validateRequest(req: SearchRequest): string | null {
  if (!req || typeof req !== 'object') return 'The search request is missing.';
  if (!isNum(req.target)) return 'The number to find must be a finite number.';
  if (req.maxCount !== null && (!Number.isInteger(req.maxCount) || req.maxCount < 1)) {
    return 'The most numbers to combine must be a whole number of at least 1 (or "any").';
  }
  if (!isNum(req.tolerance) || req.tolerance < 0) return 'The rounding tolerance must be zero or more.';
  if (!Array.isArray(req.candidates)) return 'There is no list of numbers to search.';
  for (let i = 0; i < req.candidates.length; i++) {
    const c = req.candidates[i];
    if (!c || typeof c.id !== 'string') return `Number #${i + 1} has no id.`;
    if (typeof c.fileId !== 'string') return `Number "${c.id}" does not say which file it came from.`;
    if (!isNum(c.value)) return `Number "${c.id}" is not a finite number.`;
  }
  if (req.limits != null) {
    if (typeof req.limits !== 'object') return 'The per-file limits must be a map from file id to limit.';
    for (const [fileId, lim] of Object.entries(req.limits)) {
      if (!lim || typeof lim !== 'object') return `The limit for file ${fileId} is missing.`;
      if (!isCount(lim.min)) return `The limit for file ${fileId}: "at least" must be a whole number of 0 or more.`;
      if (lim.max !== null && !isCount(lim.max)) {
        return `The limit for file ${fileId}: "at most" must be a whole number of 0 or more (or no limit).`;
      }
      if (lim.max !== null && lim.min > lim.max) {
        return `The limit for file ${fileId} asks for at least ${lim.min} but at most ${lim.max} numbers.`;
      }
    }
  }
  if (!Number.isInteger(req.maxResults) || req.maxResults < 1) return 'The result limit must be a whole number of at least 1.';
  if (typeof req.timeLimitMs !== 'number' || Number.isNaN(req.timeLimitMs) || req.timeLimitMs <= 0) {
    return 'The time limit must be more than zero.';
  }
  return null;
}

// ───────────────────────────────────────────────────────────────── ranking

interface Rec {
  match: Match;
  k: number;
  adiff: number; // scaled |diff|
  flips: number;
  order: number[]; // input positions, ascending
}

function compareRecs(a: Rec, b: Rec): number {
  if (a.k !== b.k) return a.k - b.k;
  if (a.adiff !== b.adiff) return a.adiff - b.adiff;
  if (a.flips !== b.flips) return a.flips - b.flips;
  for (let j = 0; j < a.k; j++) if (a.order[j] !== b.order[j]) return a.order[j] - b.order[j];
  return 0;
}

// ───────────────────────────────────────────────────────────────── engine

class Engine {
  private readonly req: SearchRequest;
  private readonly events: EngineEvent[] = [];
  private readonly recs: Rec[] = [];
  private finished = false;
  private pendingDone: EngineEvent | null = null;
  private startTime: number | null = null;
  private lastProgress = 0;
  private gen: Generator<void, DoneReason, unknown> | null = null;
  private prepared = false;

  // model (integers scaled by 10^d)
  private n = 0;
  private d = 0;
  private scale = 1;
  private ids: string[] = [];
  private val = new Float64Array(0);
  private file = new Int32Array(0);
  private excluded = new Uint8Array(0);
  private T = 0;
  private tol = 0;
  private lo = 0;
  private hi = 0;
  private flips = false;
  private kmax = 0; // effective max item count (≤ n)
  private knownSize = false; // maxCount ≤ 3: progress fraction is knowable
  private minF = new Float64Array(0);
  private maxF = new Float64Array(0);
  private minFiles: number[] = [];
  private sumMin = 0;
  private checkLimits = false;
  private impossible = false;
  private tmpCnt = new Int32Array(0);
  private subsetSums: Float64Array | null = null;

  // signed-entry pool for multi-item tiers
  private E = new Float64Array(0);
  private I = new Int32Array(0);
  private G = new Int8Array(0);
  private N = 0;

  // progress fraction
  private fracDone = 0;
  private fracTotal = 1;

  constructor(req: SearchRequest) {
    this.req = req;
    const problem = validateRequest(req);
    if (problem !== null) {
      this.finish('invalid', problem);
      return;
    }
    this.prepare();
  }

  get isDone(): boolean {
    return this.finished && this.pendingDone === null;
  }

  // ── public

  step(budgetMs: number): EngineEvent[] {
    if (!this.finished) {
      const t0 = now();
      if (this.startTime === null) {
        this.startTime = t0;
        this.lastProgress = t0;
      }
      const hardEnd = this.startTime + this.req.timeLimitMs;
      const end = Math.min(t0 + Math.max(0, Number(budgetMs) || 0), hardEnd);
      if (this.gen === null) this.gen = this.run();
      const firstMatchPending = this.recs.length === 0;
      let t = t0;
      for (;;) {
        const r = this.gen.next();
        if (r.done) {
          this.finish(r.value);
          break;
        }
        t = now();
        if (t >= end || (firstMatchPending && this.recs.length > 0)) break;
      }
      if (!this.finished) {
        if (t >= hardEnd) this.finish('timeLimit');
        else if (t - this.lastProgress >= PROGRESS_MS) {
          this.lastProgress = t;
          this.events.push({
            type: 'progress',
            elapsedMs: Math.round(t - this.startTime),
            found: this.recs.length,
            fraction: this.knownSize ? Math.min(1, this.fracDone / this.fracTotal) : null,
          });
        }
      }
    }
    if (this.pendingDone !== null) {
      this.events.push(this.pendingDone);
      this.pendingDone = null;
    }
    return this.events.splice(0, this.events.length);
  }

  stop(): void {
    if (!this.finished) this.finish('stopped');
  }

  // ── setup

  private prepare(): void {
    const req = this.req;
    const cands = req.candidates;
    const n = cands.length;
    this.n = n;
    this.flips = !!req.allowFlips;

    let d = Math.max(decimalsOf(req.target), decimalsOf(req.tolerance));
    let absSum = 0;
    for (let i = 0; i < n; i++) {
      const v = cands[i].value;
      if (d < MAX_DECIMALS) d = Math.max(d, decimalsOf(v));
      absSum += Math.abs(v);
    }
    const bound = absSum + Math.abs(req.target) + req.tolerance;
    while (d > 0 && bound * 10 ** d > SAFE_MAGNITUDE) d--;
    const scale = 10 ** d;
    this.d = d;
    this.scale = scale;
    const toInt = (x: number) => (x < 0 ? -Math.round(-x * scale) : Math.round(x * scale));

    this.T = toInt(req.target);
    this.tol = toInt(req.tolerance);
    this.lo = this.T - this.tol;
    this.hi = this.T + this.tol;

    // dense file indices
    const fileIdx = new Map<string, number>();
    const file = new Int32Array(n);
    const val = new Float64Array(n);
    const ids = new Array<string>(n);
    for (let i = 0; i < n; i++) {
      const c = cands[i];
      let f = fileIdx.get(c.fileId);
      if (f === undefined) {
        f = fileIdx.size;
        fileIdx.set(c.fileId, f);
      }
      file[i] = f;
      val[i] = toInt(c.value);
      ids[i] = c.id;
    }
    const F = fileIdx.size;
    const minF = new Float64Array(F);
    const maxF = new Float64Array(F).fill(Infinity);
    for (const [fileId, lim] of Object.entries(req.limits ?? {})) {
      const f = fileIdx.get(fileId);
      if (f === undefined) {
        if (lim.min > 0) this.impossible = true; // a required file has no numbers
        continue;
      }
      minF[f] = lim.min;
      maxF[f] = lim.max === null ? Infinity : lim.max;
    }
    const excluded = new Uint8Array(n);
    const avail = new Int32Array(F);
    for (let i = 0; i < n; i++) {
      if (maxF[file[i]] === 0) excluded[i] = 1;
      else avail[file[i]]++;
    }

    this.kmax = Math.min(req.maxCount ?? Infinity, n);
    this.knownSize = req.maxCount !== null && req.maxCount <= 3;
    let sumMin = 0;
    for (let f = 0; f < F; f++) {
      if (minF[f] > 0) {
        this.minFiles.push(f);
        sumMin += minF[f];
        if (minF[f] > avail[f]) this.impossible = true;
      }
      if (maxF[f] > 0 && maxF[f] < this.kmax) this.checkLimits = true;
    }
    if (this.minFiles.length > 0) this.checkLimits = true;
    if (sumMin > this.kmax) this.impossible = true;

    this.sumMin = sumMin;
    this.minF = minF;
    this.maxF = maxF;
    this.ids = ids;
    this.val = val;
    this.file = file;
    this.excluded = excluded;
    this.tmpCnt = new Int32Array(F);
    this.fracTotal = Math.max(1, n);
    this.prepared = true;
  }

  /** Signed entries for multi-item tiers: non-zero, non-excluded items; ±value with flips. */
  private buildPool(): void {
    const n = this.n;
    const val = this.val;
    const tol = this.tol;
    const vals: number[] = [];
    const items: number[] = [];
    const signs: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.excluded[i]) continue;
      const v = val[i];
      if (v <= tol && v >= -tol) continue; // "zero" items never join a combination
      vals.push(v);
      items.push(i);
      signs.push(1);
      if (this.flips) {
        vals.push(-v);
        items.push(i);
        signs.push(-1);
      }
    }
    const N = vals.length;
    const idx = Array.from({ length: N }, (_, j) => j).sort(
      (a, b) => vals[a] - vals[b] || items[a] - items[b] || signs[b] - signs[a],
    );
    const E = new Float64Array(N);
    const I = new Int32Array(N);
    const G = new Int8Array(N);
    for (let j = 0; j < N; j++) {
      E[j] = vals[idx[j]];
      I[j] = items[idx[j]];
      G[j] = signs[idx[j]];
    }
    this.E = E;
    this.I = I;
    this.G = G;
    this.N = N;
  }

  /** Per-file caps for a 1–3 item match (unused slots = -1). */
  private fits(a: number, b: number, c: number): boolean {
    const cnt = this.tmpCnt;
    const file = this.file;
    const maxF = this.maxF;
    const fa = file[a];
    const fb = b >= 0 ? file[b] : -1;
    const fc = c >= 0 ? file[c] : -1;
    cnt[fa]++;
    if (fb >= 0) cnt[fb]++;
    if (fc >= 0) cnt[fc]++;
    let ok = cnt[fa] <= maxF[fa] && (fb < 0 || cnt[fb] <= maxF[fb]) && (fc < 0 || cnt[fc] <= maxF[fc]);
    if (ok) {
      for (const g of this.minFiles) {
        if (cnt[g] < this.minF[g]) {
          ok = false;
          break;
        }
      }
    }
    cnt[fa] = 0;
    if (fb >= 0) cnt[fb] = 0;
    if (fc >= 0) cnt[fc] = 0;
    return ok;
  }

  /** True when no proper non-empty subset of the k signed values sums to within tolerance of 0. */
  private noZeroSubset(sv: Float64Array, k: number): boolean {
    const sums = (this.subsetSums ??= new Float64Array(1 << FULL_MINIMAL_MAX));
    const tol = this.tol;
    const full = (1 << k) - 1;
    sums[0] = 0;
    for (let mask = 1; mask < full; mask++) {
      const low = mask & -mask;
      const s = sums[mask ^ low] + sv[31 - Math.clz32(low)];
      sums[mask] = s;
      if (s <= tol && s >= -tol) return false;
    }
    return true;
  }

  // ── output

  private units(x: number): number {
    return Number((x / this.scale).toFixed(this.d)) + 0; // + 0 turns -0 into 0
  }

  /** Records a match; true when maxResults is reached. */
  private emit(items: number[], signs: number[], sum: number): boolean {
    const k = items.length;
    const perm = Array.from({ length: k }, (_, j) => j).sort((x, y) => items[x] - items[y]);
    const mi: MatchItem[] = [];
    const order: number[] = [];
    let flips = 0;
    for (const j of perm) {
      const sign = signs[j] < 0 ? -1 : 1;
      if (sign < 0) flips++;
      mi.push({ id: this.ids[items[j]], sign });
      order.push(items[j]);
    }
    const match: Match = { items: mi, sum: this.units(sum), diff: this.units(sum - this.T) };
    this.recs.push({ match, k, adiff: Math.abs(sum - this.T), flips, order });
    this.events.push({ type: 'match', match });
    return this.recs.length >= this.req.maxResults;
  }

  private nearest(): Nearest | null {
    if (!this.prepared) return null;
    const val = this.val;
    const T = this.T;
    let best = -1;
    let bestSign: 1 | -1 = 1;
    let bestAbs = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.excluded[i]) continue;
      const v = val[i];
      const a = Math.abs(v - T);
      if (a < bestAbs) {
        bestAbs = a;
        best = i;
        bestSign = 1;
      }
      if (this.flips) {
        const b = Math.abs(-v - T);
        if (b < bestAbs) {
          bestAbs = b;
          best = i;
          bestSign = -1;
        }
      }
    }
    if (best < 0) return null;
    return { id: this.ids[best], sign: bestSign, diff: this.units(bestSign * val[best] - T) };
  }

  private finish(reason: DoneReason, detail?: string): void {
    if (this.finished) return;
    this.finished = true;
    this.gen = null;
    const matches = this.recs.slice().sort(compareRecs).map((r) => r.match);
    const nearest = reason !== 'invalid' && matches.length === 0 ? this.nearest() : null;
    this.pendingDone =
      detail === undefined ? { type: 'done', reason, matches, nearest } : { type: 'done', reason, matches, nearest, detail };
  }

  // ── the search (a generator: yields every CHUNK work units so step() can check the clock)

  private *run(): Generator<void, DoneReason, unknown> {
    if (this.impossible || this.n === 0) return 'exhausted';
    const { lo, hi, tol, kmax, sumMin, checkLimits } = this;
    let w = 0;

    // ── tier 1: single numbers, input order
    if (sumMin <= 1) {
      const val = this.val;
      const flips = this.flips;
      for (let i = 0; i < this.n; i++) {
        if (++w >= CHUNK) {
          w = 0;
          this.fracDone = i;
          yield;
        }
        if (this.excluded[i]) continue;
        const v = val[i];
        let sign = 0;
        if (v >= lo && v <= hi) sign = 1;
        else if (flips && -v >= lo && -v <= hi) sign = -1;
        if (sign === 0) continue;
        if (checkLimits && !this.fits(i, -1, -1)) continue;
        if (this.emit([i], [sign], sign * v)) return 'maxResults';
      }
    }
    this.fracDone = this.n;
    if (kmax < 2) return 'exhausted';

    this.buildPool();
    const { E, I, G, N } = this;
    const file = this.file;
    const minF = this.minF;
    const maxF = this.maxF;
    // Multi-item feasibility with the pool's items (zero items are not in the pool).
    const poolAvail = new Int32Array(this.minF.length);
    for (let j = 0; j < N; j++) if (G[j] > 0) poolAvail[file[I[j]]]++;
    let capTotal = 0;
    for (let f = 0; f < poolAvail.length; f++) {
      if (poolAvail[f] < minF[f]) return 'exhausted';
      capTotal += Math.min(maxF[f], poolAvail[f]);
    }
    const base2 = this.n;
    const total2 = N;
    const base3 = base2 + total2;
    const total3 = kmax >= 3 ? (N * (N - 1)) / 2 : 0;
    this.fracTotal = Math.max(1, base3 + total3);

    // ── tier 2: pairs. For entry p, partners q > p with E[q] in [lo − E[p], hi − E[p]].
    if (sumMin <= 2 && capTotal >= 2) {
      let a = N; // first index with E ≥ lo − x  (moves left as x grows)
      let b = N - 1; // last index with E ≤ hi − x (moves left as x grows)
      for (let p = 0; p < N - 1; p++) {
        this.fracDone = base2 + p;
        const x = E[p];
        if (x + E[p + 1] > hi) break;
        while (b > p && E[b] > hi - x) b--;
        if (b <= p) break;
        while (a > 0 && E[a - 1] >= lo - x) a--;
        const ip = I[p];
        for (let q = a > p + 1 ? a : p + 1; q <= b; q++) {
          if (++w >= CHUNK) {
            w = 0;
            yield;
          }
          const iq = I[q];
          if (iq === ip) continue;
          if (checkLimits && !this.fits(ip, iq, -1)) continue;
          if (this.emit([ip, iq], [G[p], G[q]], x + E[q])) return 'maxResults';
        }
      }
    }
    this.fracDone = base3;
    if (kmax < 3) return 'exhausted';

    // ── tier 3: triples. For p, two pointers over (q, r), q < r, E[q] + E[r] in [L, H].
    if (sumMin <= 3 && capTotal >= 3) {
      for (let p = 0; p < N - 2; p++) {
        this.fracDone = base3 + p * N - (p * (p + 1)) / 2;
        const x = E[p];
        if (x + E[p + 1] + E[p + 2] > hi) break;
        if (x + E[N - 2] + E[N - 1] < lo) continue;
        const L = lo - x;
        const H = hi - x;
        const ip = I[p];
        let a = N;
        let b = N - 1;
        for (let q = p + 1; q < N - 1; q++) {
          if (++w >= CHUNK) {
            w = 0;
            yield;
          }
          const y = E[q];
          if (y + E[q + 1] > H) break;
          const iq = I[q];
          if (iq === ip) continue;
          const xy = x + y;
          if (xy <= tol && xy >= -tol) continue; // canceling pair
          while (b > q && E[b] > H - y) b--;
          if (b <= q) break;
          while (a > q + 1 && E[a - 1] >= L - y) a--;
          for (let r = a > q + 1 ? a : q + 1; r <= b; r++) {
            if (++w >= CHUNK) {
              w = 0;
              yield;
            }
            const ir = I[r];
            if (ir === ip || ir === iq) continue;
            const z = E[r];
            const xz = x + z;
            if (xz <= tol && xz >= -tol) continue;
            const yz = y + z;
            if (yz <= tol && yz >= -tol) continue;
            if (checkLimits && !this.fits(ip, iq, ir)) continue;
            if (this.emit([ip, iq, ir], [G[p], G[q], G[r]], xy + z)) return 'maxResults';
          }
        }
      }
    }
    this.fracDone = base3 + total3;
    if (kmax < 4) return 'exhausted';

    // ── tier 4+: resumable DFS per size k over the value-sorted entries.
    const pre = new Float64Array(N + 1);
    for (let j = 0; j < N; j++) pre[j + 1] = pre[j] + E[j];
    const used = new Uint8Array(this.n);
    const cnt = new Int32Array(minF.length);
    const sv = new Float64Array(FULL_MINIMAL_MAX);
    /** First index ≥ j whose entry can still reach lo together with the r − 1 largest entries. */
    const firstIndex = (j: number, S: number, r: number): number => {
      const need = lo - S - (pre[N] - pre[N - (r - 1)]);
      let u = j;
      let v = N;
      while (u < v) {
        const m = (u + v) >> 1;
        if (E[m] < need) u = m + 1;
        else v = m;
      }
      return u;
    };

    for (let k = 4; k <= kmax; k++) {
      if (k > capTotal) break;
      if (sumMin > k) continue;
      const minK = pre[k];
      const maxK = pre[N] - pre[N - k];
      if (minK > hi || maxK < lo) {
        // All-nonnegative head (or nonpositive tail): larger k only moves further away.
        if ((minK > hi && E[k - 1] >= 0) || (maxK < lo && E[N - k] <= 0)) break;
        continue;
      }
      const cur = new Int32Array(k);
      const S = new Float64Array(k + 1);
      const took = new Uint8Array(k);
      let deficit = sumMin;
      let d = 0;
      cur[0] = firstIndex(0, 0, k) - 1;
      for (;;) {
        if (++w >= CHUNK) {
          w = 0;
          yield;
        }
        const r = k - d;
        if (took[d]) {
          const it = I[cur[d]];
          used[it] = 0;
          const f = file[it];
          cnt[f]--;
          if (cnt[f] < minF[f]) deficit++;
          took[d] = 0;
        }
        const i = cur[d] + 1;
        // Window sums pre[i+r] − pre[i] only grow with i: the first overshoot ends this level.
        if (i > N - r || S[d] + pre[i + r] - pre[i] > hi) {
          if (d === 0) break;
          d--;
          continue;
        }
        cur[d] = i;
        const it = I[i];
        if (used[it]) continue;
        const f = file[it];
        if (cnt[f] >= maxF[f]) continue;
        if (deficit === r && cnt[f] >= minF[f]) continue; // remaining picks must fill file minimums
        const x = E[i];
        let bad = false;
        for (let q = 0; q < d; q++) {
          const s = E[cur[q]] + x;
          if (s <= tol && s >= -tol) {
            bad = true; // canceling pair
            break;
          }
        }
        if (bad) continue;
        if (r === 1) {
          // firstIndex and the overshoot break keep S[d] + x inside [lo, hi] here.
          const total = S[d] + x;
          if (k <= FULL_MINIMAL_MAX) {
            for (let q = 0; q < d; q++) sv[q] = E[cur[q]];
            sv[d] = x;
            if (!this.noZeroSubset(sv, k)) continue;
          }
          const items = new Array<number>(k);
          const signs = new Array<number>(k);
          for (let q = 0; q < k; q++) {
            items[q] = I[cur[q]];
            signs[q] = G[cur[q]];
          }
          if (this.emit(items, signs, total)) return 'maxResults';
          continue;
        }
        used[it] = 1;
        if (cnt[f] < minF[f]) deficit--;
        cnt[f]++;
        took[d] = 1;
        S[d + 1] = S[d] + x;
        cur[d + 1] = firstIndex(i + 1, S[d + 1], r - 1) - 1;
        took[d + 1] = 0;
        d++;
      }
    }
    return 'exhausted';
  }
}

/** Creates a resumable single-target search. See the header comment for the contract. */
export function createSearch(req: SearchRequest): Search {
  const e = new Engine(req);
  return {
    step: (budgetMs: number) => e.step(budgetMs),
    stop: () => e.stop(),
    get done() {
      return e.isDone;
    },
  };
}

/** Runs a search to completion synchronously (tests, bench, tiny main-thread lookups). */
export function runSearch(req: SearchRequest, sliceMs = 50): EngineEvent[] {
  const s = createSearch(req);
  const out: EngineEvent[] = [];
  while (!s.done) for (const ev of s.step(sliceMs)) out.push(ev);
  return out;
}
