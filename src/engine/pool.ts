// Number finder search pool (main thread): runs SearchRequests on a few Web Workers.
//
//   const pool = new SearchPool();
//   const handle = pool.run(request, (event) => { ... });   // events end with exactly one 'done'
//   handle.stop();                                           // done 'stopped' with matches so far
//   pool.dispose();
//
// - FIFO. Exact lookups (maxCount === 1) never go to a worker: they finish in well under 1 ms, so
//   they run right here with createSearch, in ~8 ms batches separated by setTimeout(0). That makes a
//   "Check a group" burst of hundreds of lookups cheap. Everything else goes to the workers.
// - stop() on a queued search removes it and emits done 'stopped' (matches [], nearest null)
//   asynchronously. stop() after 'done' does nothing.
// - A worker that errors: its current search gets done 'invalid' with a readable detail, the worker
//   is replaced, and the queue keeps going. If workers cannot start at all (created worker throws,
//   or two fresh workers die before saying anything), later searches run on the main thread in
//   small time slices instead.
// - Workers are created lazily, up to `size`.

import EngineWorker from './worker.ts?worker&inline';
import { createSearch, type Search } from './search';
import type { DoneReason, EngineEvent, SearchRequest } from '../types';
import type { WorkerCommand, WorkerReply } from './worker';

const MAIN_SLICE_MS = 8;
const BOOT_FAILURES_BEFORE_FALLBACK = 2;

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

interface Job {
  id: string;
  request: SearchRequest;
  onEvent: (e: EngineEvent) => void;
  finished: boolean;
  stopping: boolean;
  slot: Slot | null;
  search: Search | null; // main-thread jobs only
}

interface Slot {
  worker: Worker;
  job: Job | null;
  heard: boolean; // the worker has posted at least one message
}

function doneEvent(reason: DoneReason, detail?: string): EngineEvent {
  return detail === undefined
    ? { type: 'done', reason, matches: [], nearest: null }
    : { type: 'done', reason, matches: [], nearest: null, detail };
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string' && err.message) return err.message;
  return String(err);
}

/** Default worker count: leave one core for the page, use at most 4. */
export function defaultPoolSize(): number {
  const hc = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 2;
  return Math.max(1, Math.min(4, hc - 1));
}

export class SearchPool {
  private readonly size: number;
  private readonly createWorker: () => Worker;
  private readonly slots: Slot[] = [];
  private readonly workerQueue: Job[] = [];
  private readonly mainQueue: Job[] = [];
  private mainActive: Job | null = null;
  private mainTimer: ReturnType<typeof setTimeout> | null = null;
  private bootFailures = 0;
  private workersUnavailable = false;
  private disposed = false;
  private seq = 0;

  constructor(size?: number, createWorker?: () => Worker) {
    this.size = Math.max(1, Math.floor(size ?? defaultPoolSize()));
    this.createWorker = createWorker ?? (() => new EngineWorker());
  }

  run(request: SearchRequest, onEvent: (e: EngineEvent) => void): { stop(): void } {
    const job: Job = { id: `search-${++this.seq}`, request, onEvent, finished: false, stopping: false, slot: null, search: null };
    if (this.disposed) {
      setTimeout(() => this.emit(job, doneEvent('invalid', 'The search pool was closed.')), 0);
      return { stop() {} };
    }
    if (this.workersUnavailable || (request && request.maxCount === 1)) {
      this.mainQueue.push(job);
      this.scheduleMain();
    } else {
      this.workerQueue.push(job);
      this.pump();
    }
    return { stop: () => this.stopJob(job) };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.mainTimer !== null) clearTimeout(this.mainTimer);
    this.mainTimer = null;
    const pending: Job[] = [...this.workerQueue, ...this.mainQueue];
    this.workerQueue.length = 0;
    this.mainQueue.length = 0;
    for (const slot of this.slots) {
      if (slot.job) pending.push(slot.job);
      slot.job = null;
      try {
        slot.worker.terminate();
      } catch {
        // already gone
      }
    }
    this.slots.length = 0;
    const active = this.mainActive;
    this.mainActive = null;
    if (active?.search) {
      active.search.stop();
      const events = active.search.step(0);
      setTimeout(() => {
        for (const ev of events) this.emit(active, ev);
      }, 0);
    }
    setTimeout(() => {
      for (const job of pending) this.emit(job, doneEvent('stopped'));
    }, 0);
  }

  // ── events

  private emit(job: Job, ev: EngineEvent): void {
    if (job.finished) return;
    if (ev.type === 'done') job.finished = true;
    try {
      job.onEvent(ev);
    } catch (err) {
      setTimeout(() => {
        throw err; // surface listener bugs without breaking the pool
      }, 0);
    }
  }

  private stopJob(job: Job): void {
    if (job.finished || job.stopping) return;
    for (const queue of [this.workerQueue, this.mainQueue]) {
      const i = queue.indexOf(job);
      if (i >= 0) {
        queue.splice(i, 1);
        job.stopping = true;
        setTimeout(() => this.emit(job, doneEvent('stopped')), 0);
        return;
      }
    }
    if (job === this.mainActive && job.search) {
      job.stopping = true;
      job.search.stop(); // the next main tick delivers 'stopped' with the matches so far
      this.scheduleMain();
      return;
    }
    if (job.slot) {
      job.stopping = true;
      try {
        job.slot.worker.postMessage({ cmd: 'stop', id: job.id } satisfies WorkerCommand);
      } catch (err) {
        this.crash(job.slot, `The search engine could not be reached (${messageOf(err)}).`);
      }
    }
  }

  // ── main-thread runner (exact lookups, and the fallback when workers are unavailable)

  private scheduleMain(): void {
    if (this.mainTimer === null && !this.disposed) this.mainTimer = setTimeout(() => this.mainTick(), 0);
  }

  private mainTick(): void {
    this.mainTimer = null;
    const t0 = now();
    for (;;) {
      let job = this.mainActive;
      if (job === null) {
        job = this.mainQueue.shift() ?? null;
        if (job === null) break;
        this.mainActive = job;
        try {
          job.search = createSearch(job.request);
        } catch (err) {
          this.mainActive = null;
          this.emit(job, doneEvent('invalid', `The search failed: ${messageOf(err)}`));
          continue;
        }
      }
      const search = job.search as Search;
      let events: EngineEvent[];
      try {
        events = search.step(Math.max(1, MAIN_SLICE_MS - (now() - t0)));
      } catch (err) {
        events = [doneEvent('invalid', `The search failed: ${messageOf(err)}`)];
      }
      for (const ev of events) this.emit(job, ev);
      if (search.done || job.finished) {
        this.mainActive = null;
        job.search = null;
      }
      if (now() - t0 >= MAIN_SLICE_MS) break;
    }
    if (this.mainActive !== null || this.mainQueue.length > 0) this.scheduleMain();
  }

  // ── workers

  private spawn(): Slot | null {
    let worker: Worker;
    try {
      worker = this.createWorker();
    } catch {
      this.fallBackToMainThread();
      return null;
    }
    const slot: Slot = { worker, job: null, heard: false };
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      slot.heard = true;
      this.bootFailures = 0;
      const job = slot.job;
      const msg = e.data;
      if (job === null || !msg || msg.id !== job.id) return; // stale reply from a finished search
      this.emit(job, msg.event);
      if (msg.event.type === 'done') {
        slot.job = null;
        job.slot = null;
        this.pump();
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      e.preventDefault?.();
      this.crash(slot, `The search engine stopped unexpectedly (${e.message || 'unknown error'}). Try the search again.`);
    };
    worker.onmessageerror = () => this.crash(slot, 'The search engine sent back an unreadable message. Try the search again.');
    this.slots.push(slot);
    return slot;
  }

  private crash(slot: Slot, detail: string): void {
    const i = this.slots.indexOf(slot);
    if (i < 0) return; // already handled
    this.slots.splice(i, 1);
    try {
      slot.worker.terminate();
    } catch {
      // already gone
    }
    const job = slot.job;
    slot.job = null;
    if (job) {
      job.slot = null;
      this.emit(job, doneEvent('invalid', detail));
    }
    if (!slot.heard && ++this.bootFailures >= BOOT_FAILURES_BEFORE_FALLBACK) this.fallBackToMainThread();
    this.pump();
  }

  private fallBackToMainThread(): void {
    this.workersUnavailable = true;
    this.mainQueue.push(...this.workerQueue.splice(0, this.workerQueue.length));
    this.scheduleMain();
  }

  private pump(): void {
    if (this.disposed) return;
    while (this.workerQueue.length > 0 && !this.workersUnavailable) {
      let slot = this.slots.find((s) => s.job === null) ?? null;
      if (slot === null) {
        if (this.slots.length >= this.size) return;
        slot = this.spawn();
        if (slot === null) return;
      }
      const job = this.workerQueue.shift() as Job;
      slot.job = job;
      job.slot = slot;
      try {
        slot.worker.postMessage({ cmd: 'start', id: job.id, request: job.request } satisfies WorkerCommand);
      } catch (err) {
        slot.job = null;
        job.slot = null;
        this.emit(job, doneEvent('invalid', `The search could not be sent to the engine (${messageOf(err)}).`));
      }
    }
  }
}
