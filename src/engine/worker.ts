// Number finder search worker: a thin module Web Worker around createSearch (search.ts).
//
//   main -> worker: { cmd: 'start', id, request } | { cmd: 'stop', id }
//   worker -> main: { id, event }   (every EngineEvent of that search, ending with one 'done')
//
// One search at a time. A new 'start' stops the running search first (its 'done' is posted).
// Work runs in step(30) slices separated by setTimeout(0), so a 'stop' is handled within one slice
// and answered right away with done 'stopped' plus the matches found so far.

import { createSearch, type Search } from './search';
import type { EngineEvent, SearchRequest } from '../types';

export type WorkerCommand = { cmd: 'start'; id: string; request: SearchRequest } | { cmd: 'stop'; id: string };

export interface WorkerReply {
  id: string;
  event: EngineEvent;
}

const STEP_MS = 30;
const ctx = self as unknown as DedicatedWorkerGlobalScope;

let current: { id: string; search: Search } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function post(id: string, events: EngineEvent[]): void {
  for (const event of events) ctx.postMessage({ id, event } satisfies WorkerReply);
}

function failed(id: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  post(id, [{ type: 'done', reason: 'invalid', matches: [], nearest: null, detail: `The search failed: ${message}` }]);
}

function loop(): void {
  timer = null;
  const job = current;
  if (job === null) return;
  let events: EngineEvent[];
  try {
    events = job.search.step(STEP_MS);
  } catch (err) {
    current = null;
    failed(job.id, err);
    return;
  }
  post(job.id, events);
  if (job.search.done) {
    if (current === job) current = null;
    return;
  }
  timer = setTimeout(loop, 0);
}

/** Stops the running search (only if its id matches, when given) and posts its 'done'. */
function halt(id?: string): void {
  const job = current;
  if (job === null || (id !== undefined && job.id !== id)) return;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  current = null;
  job.search.stop();
  post(job.id, job.search.step(0));
}

ctx.onmessage = (e: MessageEvent<WorkerCommand>) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.cmd === 'start') {
    halt();
    try {
      current = { id: msg.id, search: createSearch(msg.request) };
    } catch (err) {
      failed(msg.id, err);
      return;
    }
    loop();
  } else if (msg.cmd === 'stop') {
    halt(msg.id);
  }
};
