// SearchPool tests with an in-process fake Worker (no real Web Workers in Node).
import { describe, expect, it, vi } from 'vitest';
import { createSearch, type Search } from './search';
import type { Candidate, EngineEvent, SearchRequest } from '../types';
import type { WorkerCommand } from './worker';

vi.mock('./worker.ts?worker&inline', () => ({ default: class {} }));
const { SearchPool } = await import('./pool');

type DoneEvent = Extract<EngineEvent, { type: 'done' }>;

/** Speaks the worker protocol, running createSearch in step(10) slices on timers. */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  onmessageerror: ((e: MessageEvent) => void) | null = null;
  terminated = false;
  started: string[] = [];
  private search: Search | null = null;
  private id = '';

  constructor(private readonly crashOnStart = false) {}

  postMessage(msg: WorkerCommand): void {
    if (this.terminated) return;
    if (msg.cmd === 'start') {
      this.started.push(msg.id);
      if (this.crashOnStart) {
        setTimeout(() => this.onerror?.({ message: 'boom', preventDefault() {} } as ErrorEvent), 0);
        return;
      }
      this.id = msg.id;
      this.search = createSearch(msg.request);
      this.tick();
    } else if (msg.cmd === 'stop' && this.search && msg.id === this.id) {
      this.search.stop();
      this.flush();
    }
  }

  terminate(): void {
    this.terminated = true;
    this.search = null;
  }

  private tick(): void {
    setTimeout(() => {
      if (this.terminated || !this.search) return;
      this.flush();
      if (this.search) this.tick();
    }, 0);
  }

  private flush(): void {
    const s = this.search as Search;
    const events = s.step(10);
    if (s.done) this.search = null;
    for (const event of events) this.onmessage?.({ data: { id: this.id, event } } as MessageEvent);
  }
}

function req(p: Partial<SearchRequest> & { candidates: Candidate[]; target: number }): SearchRequest {
  return { maxCount: 2, allowFlips: false, tolerance: 0, limits: {}, maxResults: 100, timeLimitMs: 10_000, ...p };
}

const cands: Candidate[] = [
  { id: 'w2:1', fileId: 'w2', value: 3500 },
  { id: 'int:1', fileId: 'int', value: -265.44 },
  { id: 'int:2', fileId: 'int', value: 3234.56 },
];

/** Unreachable (even cents vs odd target), so it runs until stopped or timed out. */
const slow = req({
  candidates: Array.from({ length: 120 }, (_, i) => ({ id: `e${i}`, fileId: 'f', value: ((i * 7919) % 100000) * 0.02 + 2 })),
  target: 12345.67,
  maxCount: null,
  allowFlips: true,
});

function collect(pool: InstanceType<typeof SearchPool>, r: SearchRequest) {
  const events: EngineEvent[] = [];
  let resolve!: (d: DoneEvent) => void;
  const done = new Promise<DoneEvent>((res) => (resolve = res));
  const handle = pool.run(r, (e) => {
    events.push(e);
    if (e.type === 'done') resolve(e);
  });
  return { events, done, handle };
}

describe('SearchPool', () => {
  it('runs multi-number searches on a worker', async () => {
    const workers: FakeWorker[] = [];
    const pool = new SearchPool(2, () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    });
    const { done, events } = collect(pool, req({ candidates: cands, target: 3234.56 }));
    const d = await done;
    expect(d.reason).toBe('exhausted');
    expect(d.matches.map((m) => m.items.map((i) => i.id))).toEqual([['int:2'], ['w2:1', 'int:1']]);
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1);
    expect(workers).toHaveLength(1);
    pool.dispose();
  });

  it('runs a burst of exact lookups on the main thread, no workers', async () => {
    const factory = vi.fn(() => new FakeWorker() as unknown as Worker);
    const pool = new SearchPool(2, factory);
    const runs = Array.from({ length: 300 }, (_, i) => collect(pool, req({ candidates: cands, target: i % 2 ? 3234.56 : 1, maxCount: 1 })));
    const dones = await Promise.all(runs.map((r) => r.done));
    expect(factory).not.toHaveBeenCalled();
    expect(dones.every((d) => d.reason === 'exhausted')).toBe(true);
    expect(dones[1].matches).toHaveLength(1);
    expect(dones[0].matches).toHaveLength(0);
    expect(runs.every((r) => r.events.filter((e) => e.type === 'done').length === 1)).toBe(true);
    pool.dispose();
  });

  it('stop() on a queued search emits done stopped asynchronously; FIFO continues', async () => {
    const pool = new SearchPool(1, () => new FakeWorker() as unknown as Worker);
    const a = collect(pool, slow);
    const b = collect(pool, req({ candidates: cands, target: 3234.56 }));
    const c = collect(pool, req({ candidates: cands, target: 3500 }));
    b.handle.stop();
    expect(b.events).toEqual([]); // not synchronous
    const db = await b.done;
    expect(db).toEqual({ type: 'done', reason: 'stopped', matches: [], nearest: null });
    a.handle.stop();
    const da = await a.done;
    expect(da.reason).toBe('stopped');
    const dc = await c.done;
    expect(dc.reason).toBe('exhausted');
    expect(dc.matches).toHaveLength(1);
    b.handle.stop(); // after done: nothing
    await new Promise((r) => setTimeout(r, 5));
    expect(b.events).toHaveLength(1);
    pool.dispose();
  });

  it('a crashing worker fails its search with a readable detail and is replaced', async () => {
    let made = 0;
    const pool = new SearchPool(1, () => new FakeWorker(made++ === 0) as unknown as Worker);
    const a = collect(pool, req({ candidates: cands, target: 3234.56 }));
    const b = collect(pool, req({ candidates: cands, target: 3234.56 }));
    const da = await a.done;
    expect(da.reason).toBe('invalid');
    expect(da.detail).toMatch(/stopped unexpectedly/);
    const db = await b.done;
    expect(db.reason).toBe('exhausted');
    expect(made).toBe(2);
    pool.dispose();
  });

  it('falls back to the main thread when workers cannot be created', async () => {
    const pool = new SearchPool(2, () => {
      throw new Error('blocked by CSP');
    });
    const d = await collect(pool, req({ candidates: cands, target: 3234.56 })).done;
    expect(d.reason).toBe('exhausted');
    expect(d.matches).toHaveLength(2);
    pool.dispose();
  });
});
