// App state and actions. One module-level store read by React through useSyncExternalStore.
//
// Contracts:
//   - File bytes live outside the state (fileData) so the state stays small and serializable.
//   - Groups reference files by key ("name|size"), so a re-dropped file slots back into its groups.
//   - Only SETUP is saved between sessions (groups, find settings, layout, run definitions) — never file
//     contents, amounts, or results.
//   - One find box serves both jobs: a number ("what makes 3,235") or, with a group picked, every number
//     in that group. Both become a Run in one list. Filter words (-hours) narrow what's searched and what's
//     checked, before the search runs.

import { useSyncExternalStore } from 'react';
import type { Amount, DoneReason, EngineEvent, FileLimit, Match, ParsedFile, Rounding, SearchRequest } from '../types';
import { ROUNDING_TOLERANCE } from '../types';
import { extractFile } from '../extract';
import { SearchPool } from '../engine/pool';
import { forgetPdf, getPdfjs } from '../lib/pdf';
import { madeOfLabel, parseLimit, ROUNDING_SHORT, uid } from '../lib/format';
import { hasTerms, parseQuery, passesTerms, serializeTerms, termsPhrase, type Terms } from '../lib/query';

export const ALL_FILES = '__all__';
const STORAGE_KEY = 'number-finder:setup:v2';
const GROUP_COLORS = 6;
const READ_TIMEOUT_MS = 60_000;

// ---------- state shape ----------

export interface FileEntry {
  id: string;
  /** Identity that survives sessions: "name|size". */
  key: string;
  name: string;
  size: number;
  status: 'reading' | 'ready' | 'error';
  parsed: ParsedFile | null;
  error?: string;
}

export interface GroupMember { key: string; name: string; limit: string }
export interface Group { id: string; name: string; color: number; members: GroupMember[] }

/** groupId is the group searched IN. */
export interface FindSettings { groupId: string; maxCount: number | null; rounding: Rounding; allowFlips: boolean }

type RunStatus = 'idle' | 'running' | 'done' | 'stopped';
interface RunBase { id: string; settings: FindSettings; terms: Terms; status: RunStatus; startedAt: number; elapsedMs: number }

export interface SearchRun extends RunBase {
  kind: 'search';
  target: number;
  targetDecimals: number;
  originId: string | null;
  reason: DoneReason | null;
  detail?: string;
  matches: Match[];
  progress: number | null;
}

export type RowStatus = 'pending' | 'found' | 'combo' | 'notfound';
export interface CheckRow { amountId: string; status: RowStatus; matches: Match[] }

export interface CheckRun extends RunBase {
  kind: 'check';
  /** The group whose every number is checked (against settings.groupId). */
  checkGroupId: string;
  rows: CheckRow[];
  skippedZeros: number;
  skippedByTerms: number;
  selectedAmountId: string | null;
}

export type Run = SearchRun | CheckRun;

export interface Notice { kind: 'info' | 'warn' | 'error'; text: string; action?: { label: string; run: () => void } }
export interface Layout { sidebarHidden: boolean }

export interface AppState {
  files: FileEntry[];
  groups: Group[];
  find: FindSettings;
  /** What's typed in the find box: a number and/or filter words. */
  findText: string;
  /** With a group picked, the box checks every number in it instead of one number. */
  scopeGroupId: string | null;
  runs: Run[];
  selectedRunId: string | null;
  /** Amount shown in the side pane. */
  previewId: string | null;
  notice: Notice | null;
  dragging: boolean;
  layout: Layout;
}

// ---------- store plumbing ----------

export const fileData = new Map<string, ArrayBuffer>();
const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let state: AppState = loadSetup();
let emitQueued = false;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let pool: SearchPool | null = null;
/** Running engine searches: a search run's id, or `${checkRunId}:${amountId}` for one check row. */
const handles = new Map<string, { stop(): void }>();

const getPool = () => (pool ??= new SearchPool());

function emit() {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => { emitQueued = false; for (const l of listeners) l(); });
}

function set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { persistTimer = undefined; saveSetup(); }, 300);
  emit();
}

export function getState(): AppState { return state; }

export function useAppState(): AppState {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}

// ---------- persistence (setup only) ----------

type SavedRun =
  | { kind: 'search'; target: number; targetDecimals: number; settings: FindSettings; terms: Terms }
  | { kind: 'check'; checkGroupId: string; settings: FindSettings; terms: Terms };

interface SavedSetup { groups: Group[]; find: FindSettings; scopeGroupId: string | null; layout: Layout; runs: SavedRun[] }

// A function declaration, not a const: loadSetup() runs at module load, before consts below it exist.
function defaultFind(): FindSettings {
  return { groupId: ALL_FILES, maxCount: 1, rounding: 'dollar', allowFlips: false };
}

function restoreRun(r: SavedRun): Run {
  const base = { settings: r.settings, terms: r.terms ?? { include: [], exclude: [] }, status: 'idle' as const, startedAt: 0, elapsedMs: 0 };
  return r.kind === 'check'
    ? { ...base, kind: 'check', id: uid('c'), checkGroupId: r.checkGroupId, rows: [], skippedZeros: 0, skippedByTerms: 0, selectedAmountId: null }
    : { ...base, kind: 'search', id: uid('s'), target: r.target, targetDecimals: r.targetDecimals, originId: null, reason: null, matches: [], progress: null };
}

function loadSetup(): AppState {
  const base: AppState = {
    files: [], groups: [], find: defaultFind(), findText: '', scopeGroupId: null, runs: [], selectedRunId: null,
    previewId: null, notice: null, dragging: false, layout: { sidebarHidden: false },
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as SavedSetup;
    return {
      ...base,
      groups: saved.groups ?? [],
      find: { ...defaultFind(), ...saved.find },
      scopeGroupId: saved.scopeGroupId ?? null,
      layout: { ...base.layout, ...saved.layout },
      runs: (saved.runs ?? []).map(restoreRun),
    };
  } catch {
    return base;
  }
}

function saveSetup() {
  const runs: SavedRun[] = state.runs.slice(0, 30).map(r => (r.kind === 'check'
    ? { kind: 'check', checkGroupId: r.checkGroupId, settings: r.settings, terms: r.terms }
    : { kind: 'search', target: r.target, targetDecimals: r.targetDecimals, settings: r.settings, terms: r.terms }));
  const saved: SavedSetup = { groups: state.groups, find: state.find, scopeGroupId: state.scopeGroupId, layout: state.layout, runs };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* storage full or blocked: setup just isn't remembered */ }
}

// Saves are debounced; flush the pending one when the page is closed, reloaded, or hidden.
function flushSetup() {
  if (persistTimer === undefined) return;
  clearTimeout(persistTimer);
  persistTimer = undefined;
  saveSetup();
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSetup);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSetup(); });
}

// ---------- derived data ----------

let indexCache: { files: FileEntry[]; map: Map<string, { amount: Amount; file: FileEntry }> } | null = null;

/** Every amount in every ready file, by id. */
export function amountIndex(s: AppState = state): Map<string, { amount: Amount; file: FileEntry }> {
  if (!indexCache || indexCache.files !== s.files) {
    const map = new Map<string, { amount: Amount; file: FileEntry }>();
    for (const f of s.files) for (const a of f.parsed?.amounts ?? []) map.set(a.id, { amount: a, file: f });
    indexCache = { files: s.files, map };
  }
  return indexCache.map;
}

export function groupById(s: AppState, id: string | null): Group | undefined {
  return id ? s.groups.find(g => g.id === id) : undefined;
}

export function groupName(s: AppState, id: string): string {
  return id === ALL_FILES ? 'All files' : groupById(s, id)?.name ?? 'a deleted group';
}

/** Ready files in a group (or every ready file for "All files"), with each file's limit. */
export function groupFiles(s: AppState, id: string): { file: FileEntry; limit: FileLimit | null }[] {
  const ready = s.files.filter(f => f.status === 'ready' && f.parsed);
  if (id === ALL_FILES) return ready.map(file => ({ file, limit: null }));
  const g = groupById(s, id);
  if (!g) return [];
  return g.members.flatMap(m => {
    const file = ready.find(f => f.key === m.key);
    return file ? [{ file, limit: parseLimit(m.limit) }] : [];
  });
}

/** Every amount in a group's loaded files. */
export function groupAmounts(s: AppState, id: string): Amount[] {
  return groupFiles(s, id).flatMap(m => m.file.parsed?.amounts ?? []);
}

export function groupsOfFile(s: AppState, key: string): Group[] {
  return s.groups.filter(g => g.members.some(m => m.key === key));
}

/** "in Source docs · sums of up to 3 · whole dollars · negatives · skipping “hours”" */
export function runSummary(s: AppState, r: { settings: FindSettings; terms: Terms }): string {
  const parts = [`in ${groupName(s, r.settings.groupId)}`, madeOfLabel(r.settings.maxCount), ROUNDING_SHORT[r.settings.rounding]];
  if (r.settings.allowFlips) parts.push('negatives');
  const t = termsPhrase(r.terms);
  if (t) parts.push(t);
  return parts.join(' · ');
}

// ---------- notices ----------

export function notify(kind: Notice['kind'], text: string, action?: Notice['action']) {
  clearTimeout(noticeTimer);
  set({ notice: { kind, text, action } });
  noticeTimer = setTimeout(() => set({ notice: null }), kind === 'error' ? 8000 : 6000);
}
export function dismissNotice() { clearTimeout(noticeTimer); set({ notice: null }); }

// ---------- layout ----------

export function setLayout(patch: Partial<Layout>) { set(s => ({ layout: { ...s.layout, ...patch } })); }

// ---------- files ----------

const fileKey = (f: { name: string; size: number }) => `${f.name}|${f.size}`;

/** A file that never finishes reading must say so instead of showing "Reading…" forever. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

export async function addFiles(list: File[]): Promise<void> {
  const fresh = list.filter(f => !state.files.some(e => e.key === fileKey(f)));
  const dupes = list.length - fresh.length;
  if (dupes) notify('info', dupes === 1 ? `${list.find(f => state.files.some(e => e.key === fileKey(f)))?.name} is already added.` : `${dupes} files were already added.`);
  const entries: FileEntry[] = fresh.map(f => ({ id: uid('f'), key: fileKey(f), name: f.name, size: f.size, status: 'reading', parsed: null }));
  set(s => ({ files: [...s.files, ...entries], dragging: false }));

  await Promise.all(entries.map(async (entry, i) => {
    try {
      const data = await fresh[i].arrayBuffer();
      fileData.set(entry.id, data);
      const parsed = await withTimeout(
        extractFile({ id: entry.id, name: entry.name, size: entry.size, data: data.slice(0) }, { pdfjs: getPdfjs() }),
        READ_TIMEOUT_MS,
      );
      updateFile(entry.id, { status: 'ready', parsed });
    } catch (err) {
      console.error(err);
      const timedOut = err instanceof Error && err.message === 'timeout';
      updateFile(entry.id, { status: 'error', error: timedOut ? "Couldn't read this file: it took longer than a minute." : "Couldn't read this file." });
    }
  }));
}

function updateFile(id: string, patch: Partial<FileEntry>) {
  set(s => ({ files: s.files.map(f => (f.id === id ? { ...f, ...patch } : f)) }));
}

export function removeFile(id: string) {
  const f = state.files.find(x => x.id === id);
  if (!f) return;
  fileData.delete(id);
  forgetPdf(id);
  set(s => ({
    files: s.files.filter(x => x.id !== id),
    groups: s.groups.map(g => ({ ...g, members: g.members.filter(m => m.key !== f.key) })),
    previewId: s.previewId && s.previewId.startsWith(`${id}:`) ? null : s.previewId,
  }));
}

export function setDragging(dragging: boolean) { if (state.dragging !== dragging) set({ dragging }); }

// ---------- groups ----------

export function createGroup(name?: string): string {
  const id = uid('g');
  const n = state.groups.length + 1;
  const used = new Set(state.groups.map(g => g.color));
  const color = [...Array(GROUP_COLORS).keys()].find(c => !used.has(c)) ?? n % GROUP_COLORS;
  set(s => ({ groups: [...s.groups, { id, name: name || `Group ${n}`, color, members: [] }] }));
  return id;
}

export function renameGroup(id: string, name: string) {
  const clean = name.trim();
  if (!clean) return;
  set(s => ({ groups: s.groups.map(g => (g.id === id ? { ...g, name: clean } : g)) }));
}

export function deleteGroup(id: string) {
  const index = state.groups.findIndex(g => g.id === id);
  const g = state.groups[index];
  if (!g) return;
  set(s => ({
    groups: s.groups.filter(x => x.id !== id),
    find: s.find.groupId === id ? { ...s.find, groupId: ALL_FILES } : s.find,
    scopeGroupId: s.scopeGroupId === id ? null : s.scopeGroupId,
  }));
  notify('info', `Deleted ${g.name}.`, {
    label: 'Undo',
    run: () => { set(s => ({ groups: [...s.groups.slice(0, index), g, ...s.groups.slice(index)] })); dismissNotice(); },
  });
}

export function addMember(groupId: string, file: { key: string; name: string }) {
  set(s => ({
    groups: s.groups.map(g => (g.id === groupId && !g.members.some(m => m.key === file.key)
      ? { ...g, members: [...g.members, { key: file.key, name: file.name, limit: '' }] }
      : g)),
  }));
}

export function removeMember(groupId: string, key: string) {
  set(s => ({ groups: s.groups.map(g => (g.id === groupId ? { ...g, members: g.members.filter(m => m.key !== key) } : g)) }));
}

export function setLimit(groupId: string, key: string, limit: string) {
  set(s => ({
    groups: s.groups.map(g => (g.id === groupId
      ? { ...g, members: g.members.map(m => (m.key === key ? { ...m, limit: limit.trim() } : m)) }
      : g)),
  }));
}

// ---------- the find box ----------

export function setFind(patch: Partial<FindSettings>) { set(s => ({ find: { ...s.find, ...patch } })); }
export function setFindText(findText: string) { set({ findText }); }
export function setScope(scopeGroupId: string | null) { set({ scopeGroupId }); }

function currentSettings(): FindSettings {
  const g = state.find.groupId;
  return { ...state.find, groupId: g === ALL_FILES || groupById(state, g) ? g : ALL_FILES };
}

/** Enter in the find box: search for the typed number, or check every number in the picked group. */
export function submitFind(): boolean {
  const q = parseQuery(state.findText);
  if (q.extraNumbers.length) {
    notify('error', 'Search for one number at a time. To look up many numbers, pick a group with Check a group.');
    return false;
  }
  const settings = currentSettings();
  if (state.scopeGroupId) {
    if (q.value !== null) {
      notify('warn', `A group is picked, so the box only takes filters. Remove the group to search for ${q.valueText}.`);
      return false;
    }
    return startCheck(state.scopeGroupId, settings, q.terms);
  }
  if (q.value === null) {
    notify('error', 'Type a number to find, like 3,235, or use Check a group to look up every number in a group.');
    return false;
  }
  const ok = runSearch(q.value, q.decimals, q.terms, null, settings);
  // Filters stay in the box for the next number.
  if (ok) { const rest = serializeTerms(q.terms); set({ findText: rest ? `${rest} ` : '' }); }
  return ok;
}

function buildRequest(
  s: AppState,
  settings: FindSettings,
  target: number,
  exclude: string | null,
  terms: Terms,
  budget: { maxResults: number; timeLimitMs: number },
): SearchRequest | string {
  const members = groupFiles(s, settings.groupId);
  if (!members.length) {
    return settings.groupId === ALL_FILES ? 'Add some files first.' : `${groupName(s, settings.groupId)} has no files loaded yet. Add files to it first.`;
  }
  const limits: Record<string, FileLimit> = {};
  for (const m of members) {
    if (m.limit === null) {
      const member = groupById(s, settings.groupId)?.members.find(x => x.key === m.file.key);
      if (member) return `The limit for ${member.name} should be like 1, 0-2, or any.`;
      continue;
    }
    if (m.limit.min > 0 || m.limit.max !== null) limits[m.file.id] = m.limit;
  }
  const candidates = members.flatMap(m => (m.file.parsed?.amounts ?? [])
    .filter(a => a.id !== exclude && passesTerms(a, m.file.name, terms))
    .map(a => ({ id: a.id, fileId: a.fileId, value: a.value })));
  if (!candidates.length) {
    return hasTerms(terms)
      ? `No numbers in ${groupName(s, settings.groupId)} are left after the filters (${termsPhrase(terms)}).`
      : `There are no numbers in ${groupName(s, settings.groupId)} to search.`;
  }
  return {
    target,
    maxCount: settings.maxCount,
    allowFlips: settings.allowFlips,
    tolerance: ROUNDING_TOLERANCE[settings.rounding],
    candidates,
    limits,
    ...budget,
  };
}

// ---------- single searches ----------

const SEARCH_BUDGET = { maxResults: 50, timeLimitMs: 10_000 };

export function runSearch(target: number, decimals: number, terms: Terms, originId: string | null, settings: FindSettings = currentSettings()): boolean {
  const request = buildRequest(state, settings, target, originId, terms, SEARCH_BUDGET);
  if (typeof request === 'string') { notify('warn', request); return false; }
  const run: SearchRun = {
    kind: 'search', id: uid('s'), target, targetDecimals: decimals, originId, settings, terms, status: 'running', reason: null,
    matches: [], progress: 0, startedAt: performance.now(), elapsedMs: 0,
  };
  set(s => ({ runs: [run, ...s.runs], selectedRunId: run.id, previewId: null }));
  startSearch(run.id, request);
  return true;
}

function startSearch(id: string, request: SearchRequest) {
  handles.set(id, getPool().run(request, ev => onSearchEvent(id, ev)));
}

function patchRun(id: string, fn: (r: Run) => Partial<SearchRun> | Partial<CheckRun>) {
  set(s => ({ runs: s.runs.map(r => (r.id === id ? ({ ...r, ...fn(r) } as Run) : r)) }));
}

function onSearchEvent(id: string, ev: EngineEvent) {
  if (ev.type === 'progress') {
    patchRun(id, () => ({ progress: ev.fraction, elapsedMs: ev.elapsedMs }));
  } else if (ev.type === 'match') {
    patchRun(id, r => ({ matches: [...(r as SearchRun).matches, ev.match] }));
  } else {
    handles.delete(id);
    patchRun(id, r => ({
      status: 'done', reason: ev.reason, detail: ev.detail, matches: ev.matches, progress: 1, elapsedMs: performance.now() - r.startedAt,
    }));
    const r = state.runs.find(x => x.id === id);
    if (r?.kind === 'search' && state.selectedRunId === id && !state.previewId && r.matches[0]) set({ previewId: r.matches[0].items[0].id });
  }
}

/** Clicking a number in a preview: search for it with the current settings and filters. */
export function searchForAmount(amountId: string) {
  const hit = amountIndex().get(amountId);
  if (!hit) return;
  runSearch(hit.amount.value, hit.amount.decimals, parseQuery(state.findText).terms, amountId);
}

/** From a miss: widen the settings and search the same number again. */
export function retryWith(target: number, decimals: number, originId: string | null, terms: Terms, patch: Partial<FindSettings>) {
  setFind(patch);
  runSearch(target, decimals, terms, originId);
}

// ---------- checking every number in a group ----------

export function startCheck(checkGroupId: string, settings: FindSettings, terms: Terms): boolean {
  if (checkGroupId === settings.groupId) {
    notify('warn', `Checking ${groupName(state, checkGroupId)} against itself would find every number in itself. Pick a different group to look in.`);
    return false;
  }
  const run: CheckRun = {
    kind: 'check', id: uid('c'), checkGroupId, settings, terms, status: 'running', rows: [], skippedZeros: 0, skippedByTerms: 0,
    selectedAmountId: null, startedAt: performance.now(), elapsedMs: 0,
  };
  return launchCheck(run, true);
}

function launchCheck(base: CheckRun, isNew: boolean): boolean {
  const checked = groupFiles(state, base.checkGroupId);
  if (!checked.length) { notify('warn', `${groupName(state, base.checkGroupId)} has no files loaded yet.`); return false; }
  const all = checked.flatMap(m => (m.file.parsed?.amounts ?? []).map(a => ({ a, fileName: m.file.name })));
  const kept = all.filter(x => passesTerms(x.a, x.fileName, base.terms)).map(x => x.a);
  const nonZero = kept.filter(a => Math.abs(a.value) >= 0.005);
  if (!nonZero.length) {
    notify('warn', `There are no numbers to check in ${groupName(state, base.checkGroupId)}${hasTerms(base.terms) ? ' after the filters' : ''}.`);
    return false;
  }
  const probe = buildRequest(state, base.settings, 1, null, base.terms, { maxResults: 1, timeLimitMs: 1 });
  if (typeof probe === 'string') { notify('warn', probe); return false; }

  const run: CheckRun = {
    ...base,
    status: 'running',
    rows: nonZero.map(a => ({ amountId: a.id, status: 'pending', matches: [] })),
    skippedZeros: kept.length - nonZero.length,
    skippedByTerms: all.length - kept.length,
    selectedAmountId: null, // until a row is picked, the table's first row is shown
    startedAt: performance.now(),
    elapsedMs: 0,
  };
  set(s => ({
    runs: isNew ? [run, ...s.runs] : s.runs.map(r => (r.id === run.id ? run : r)),
    selectedRunId: run.id,
    previewId: null,
  }));

  const budget = { maxResults: 3, timeLimitMs: base.settings.maxCount === null ? 3000 : 1500 };
  for (const a of nonZero) {
    const request = buildRequest(state, base.settings, a.value, a.id, base.terms, budget);
    if (typeof request === 'string') { onCheckRow(run.id, a.id, []); continue; }
    const key = `${run.id}:${a.id}`;
    handles.set(key, getPool().run(request, ev => {
      if (ev.type !== 'done' || ev.reason === 'stopped') return;
      onCheckRow(run.id, a.id, ev.matches);
    }));
  }
  return true;
}

function onCheckRow(runId: string, amountId: string, matches: Match[]) {
  handles.delete(`${runId}:${amountId}`);
  const best = matches[0];
  const status: RowStatus = !best ? 'notfound' : best.items.length === 1 ? 'found' : 'combo';
  set(s => ({
    runs: s.runs.map(r => {
      if (r.id !== runId || r.kind !== 'check' || r.status !== 'running') return r;
      const rows = r.rows.map(x => (x.amountId === amountId ? { ...x, status, matches } : x));
      const finished = rows.every(x => x.status !== 'pending');
      return { ...r, rows, status: finished ? 'done' : r.status, elapsedMs: finished ? performance.now() - r.startedAt : r.elapsedMs };
    }),
  }));
}

export function selectCheckRow(runId: string, amountId: string) {
  set(s => ({
    runs: s.runs.map(r => (r.id === runId && r.kind === 'check' ? { ...r, selectedAmountId: amountId } : r)),
    previewId: amountId,
  }));
}

// ---------- the list of runs ----------

export function stopRun(id: string) {
  const r = state.runs.find(x => x.id === id);
  if (!r) return;
  if (r.kind === 'search') { handles.get(id)?.stop(); return; }
  for (const [key, h] of handles) if (key.startsWith(`${id}:`)) { h.stop(); handles.delete(key); }
  if (r.status === 'running') patchRun(id, () => ({ status: 'stopped', elapsedMs: performance.now() - r.startedAt }));
}

export function removeRun(id: string) {
  stopRun(id);
  handles.delete(id);
  set(s => {
    const runs = s.runs.filter(r => r.id !== id);
    return { runs, selectedRunId: s.selectedRunId === id ? runs[0]?.id ?? null : s.selectedRunId };
  });
}

export function clearFinished() {
  set(s => {
    const runs = s.runs.filter(r => r.status === 'running');
    return { runs, selectedRunId: runs.some(r => r.id === s.selectedRunId) ? s.selectedRunId : runs[0]?.id ?? null };
  });
}

/** Run a restored (idle) or finished run again with its saved settings and filters. */
export function rerunRun(id: string) {
  const r = state.runs.find(x => x.id === id);
  if (!r) return;
  stopRun(id);
  if (r.kind === 'check') { launchCheck(r, false); return; }
  const request = buildRequest(state, r.settings, r.target, r.originId, r.terms, SEARCH_BUDGET);
  if (typeof request === 'string') { notify('warn', request); return; }
  patchRun(id, () => ({ status: 'running', reason: null, matches: [], progress: 0, startedAt: performance.now() }));
  set({ selectedRunId: id, previewId: null });
  startSearch(id, request);
}

export function selectRun(id: string) {
  const r = state.runs.find(x => x.id === id);
  const previewId = !r ? null : r.kind === 'search' ? r.matches[0]?.items[0].id ?? null : r.selectedAmountId ?? r.rows[0]?.amountId ?? null;
  set({ selectedRunId: id, previewId });
}

export function showPreview(amountId: string | null) { set({ previewId: amountId }); }
