// App state and actions. One module-level store read by React through useSyncExternalStore.
//
// Contracts:
//   - File bytes live outside the state (fileData) so the state stays small and serializable.
//   - Groups reference files by key ("name|size"), so a re-dropped file slots back into its groups.
//   - Only SETUP is saved between sessions (groups, find settings, search definitions) — never file
//     contents, amounts, or results.

import { useSyncExternalStore } from 'react';
import type { Amount, DoneReason, EngineEvent, FileLimit, Match, Nearest, ParsedFile, Rounding, SearchRequest } from '../types';
import { ROUNDING_TOLERANCE } from '../types';
import { extractFile } from '../extract';
import { SearchPool } from '../engine/pool';
import { forgetPdf, getPdfjs } from '../lib/pdf';
import { decimalsOf, formatMoney, madeOfLabel, parseAmountInput, parseLimit, ROUNDING_SHORT, uid } from '../lib/format';

export const ALL_FILES = '__all__';
const STORAGE_KEY = 'number-finder:setup:v1';
const GROUP_COLORS = 6;

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

export interface FindSettings { groupId: string; maxCount: number | null; rounding: Rounding; allowFlips: boolean }

export interface SearchRun {
  id: string;
  target: number;
  targetDecimals: number;
  originId: string | null;
  settings: FindSettings;
  status: 'idle' | 'running' | 'done';
  reason: DoneReason | null;
  detail?: string;
  matches: Match[];
  nearest: Nearest | null;
  progress: number | null;
  startedAt: number;
  elapsedMs: number;
}

export type RowStatus = 'pending' | 'found' | 'combo' | 'notfound';
export interface CheckRow { amountId: string; status: RowStatus; matches: Match[]; nearest: Nearest | null }
export interface CheckRun {
  id: string;
  checkGroupId: string;
  againstGroupId: string;
  settings: Omit<FindSettings, 'groupId'>;
  rows: CheckRow[];
  status: 'running' | 'done' | 'stopped';
  skippedZeros: number;
}

export interface Notice { kind: 'info' | 'warn' | 'error'; text: string; action?: { label: string; run: () => void } }

export interface AppState {
  files: FileEntry[];
  groups: Group[];
  find: FindSettings;
  /** What's typed in the find box (not saved). */
  findText: string;
  searches: SearchRun[];
  selectedSearchId: string | null;
  /** Amount shown in the preview. */
  previewId: string | null;
  view: 'workspace' | 'check';
  check: CheckRun | null;
  checkSetupOpen: boolean;
  notice: Notice | null;
  dragging: boolean;
}

// ---------- store plumbing ----------

export const fileData = new Map<string, ArrayBuffer>();
const listeners = new Set<() => void>();
let state: AppState = loadSetup();
let emitQueued = false;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let pool: SearchPool | null = null;
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
  persistTimer = setTimeout(saveSetup, 300);
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

interface SavedSetup {
  groups: Group[];
  find: FindSettings;
  searches: { target: number; targetDecimals: number; settings: FindSettings }[];
}

function defaultFind(): FindSettings {
  return { groupId: ALL_FILES, maxCount: 1, rounding: 'dollar', allowFlips: false };
}

function loadSetup(): AppState {
  const base: AppState = {
    files: [], groups: [], find: defaultFind(), findText: '', searches: [], selectedSearchId: null, previewId: null,
    view: 'workspace', check: null, checkSetupOpen: false, notice: null, dragging: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as SavedSetup;
    const searches: SearchRun[] = (saved.searches || []).map(s => ({
      id: uid('s'), target: s.target, targetDecimals: s.targetDecimals, originId: null, settings: s.settings,
      status: 'idle', reason: null, matches: [], nearest: null, progress: null, startedAt: 0, elapsedMs: 0,
    }));
    return { ...base, groups: saved.groups || [], find: { ...defaultFind(), ...saved.find }, searches };
  } catch {
    return base;
  }
}

function saveSetup() {
  const saved: SavedSetup = {
    groups: state.groups,
    find: state.find,
    searches: state.searches.slice(0, 30).map(s => ({ target: s.target, targetDecimals: s.targetDecimals, settings: s.settings })),
  };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch { /* storage full or blocked: setup just isn't remembered */ }
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

export function groupById(s: AppState, id: string): Group | undefined {
  return s.groups.find(g => g.id === id);
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

export function groupsOfFile(s: AppState, key: string): Group[] {
  return s.groups.filter(g => g.members.some(m => m.key === key));
}

export function settingsSummary(s: AppState, settings: Omit<FindSettings, 'groupId'> & { groupId?: string }): string {
  const parts = [];
  if (settings.groupId) parts.push(`in ${groupName(s, settings.groupId)}`);
  parts.push(madeOfLabel(settings.maxCount), ROUNDING_SHORT[settings.rounding]);
  if (settings.allowFlips) parts.push('negatives');
  return parts.join(' · ');
}

// ---------- notices ----------

export function notify(kind: Notice['kind'], text: string, action?: Notice['action']) {
  clearTimeout(noticeTimer);
  set({ notice: { kind, text, action } });
  noticeTimer = setTimeout(() => set({ notice: null }), kind === 'error' ? 8000 : 6000);
}
export function dismissNotice() { clearTimeout(noticeTimer); set({ notice: null }); }

// ---------- files ----------

const fileKey = (f: { name: string; size: number }) => `${f.name}|${f.size}`;

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
      const parsed = await extractFile({ id: entry.id, name: entry.name, size: entry.size, data: data.slice(0) }, { pdfjs: getPdfjs() });
      updateFile(entry.id, { status: 'ready', parsed });
    } catch (err) {
      console.error(err);
      updateFile(entry.id, { status: 'error', error: "Couldn't read this file." });
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

// ---------- single searches ----------

export function setFind(patch: Partial<FindSettings>) { set(s => ({ find: { ...s.find, ...patch } })); }
export function setFindText(findText: string) { set({ findText }); }

/** From a not-found result: widen the settings and search the same number again. */
export function retryWith(target: number, decimals: number, originId: string | null, patch: Partial<FindSettings>) {
  setFind(patch);
  set({ view: 'workspace' });
  runSearch(formatMoney(target, decimals).replace('−', '-'), originId);
}

function buildRequest(
  s: AppState,
  groupId: string,
  settings: Omit<FindSettings, 'groupId'>,
  target: number,
  exclude: string | null,
  budget: { maxResults: number; timeLimitMs: number },
): SearchRequest | string {
  const members = groupFiles(s, groupId);
  if (!members.length) {
    return groupId === ALL_FILES ? 'Add some files first.' : `${groupName(s, groupId)} has no files yet. Add files to it first.`;
  }
  const limits: Record<string, FileLimit> = {};
  for (const m of members) {
    if (m.limit === null) {
      const member = groupById(s, groupId)?.members.find(x => x.key === m.file.key);
      if (member) return `The limit for ${member.name} should be like 1, 0-2, or any.`;
      continue;
    }
    if (m.limit.min > 0 || m.limit.max !== null) limits[m.file.id] = m.limit;
  }
  const candidates = members.flatMap(m => (m.file.parsed?.amounts ?? [])
    .filter(a => a.id !== exclude)
    .map(a => ({ id: a.id, fileId: a.fileId, value: a.value })));
  if (!candidates.length) return `There are no numbers in ${groupName(s, groupId)} to search.`;
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

/** Start a search. text: what the user typed (or the clicked amount's text). */
export function runSearch(text: string, originId: string | null = null): boolean {
  const target = parseAmountInput(text);
  if (target === null) { notify('error', 'Type a number to find, like 3,235 or 3,234.56.'); return false; }
  const settings = { ...state.find, groupId: groupById(state, state.find.groupId) ? state.find.groupId : ALL_FILES };
  const request = buildRequest(state, settings.groupId, settings, target, originId, { maxResults: 50, timeLimitMs: 10_000 });
  if (typeof request === 'string') { notify('warn', request); return false; }
  const run: SearchRun = {
    id: uid('s'), target, targetDecimals: decimalsOf(text), originId, settings, status: 'running', reason: null,
    matches: [], nearest: null, progress: 0, startedAt: performance.now(), elapsedMs: 0,
  };
  set(s => ({ searches: [run, ...s.searches], selectedSearchId: run.id, previewId: null }));
  start(run.id, request);
  return true;
}

function start(id: string, request: SearchRequest) {
  handles.set(id, getPool().run(request, ev => onSearchEvent(id, ev)));
}

function patchSearch(id: string, fn: (r: SearchRun) => Partial<SearchRun>) {
  set(s => ({ searches: s.searches.map(r => (r.id === id ? { ...r, ...fn(r) } : r)) }));
}

function onSearchEvent(id: string, ev: EngineEvent) {
  if (ev.type === 'progress') {
    patchSearch(id, () => ({ progress: ev.fraction, elapsedMs: ev.elapsedMs }));
  } else if (ev.type === 'match') {
    patchSearch(id, r => ({ matches: [...r.matches, ev.match] }));
  } else {
    handles.delete(id);
    patchSearch(id, r => ({
      status: 'done', reason: ev.reason, detail: ev.detail, matches: ev.matches, nearest: ev.nearest,
      progress: 1, elapsedMs: performance.now() - r.startedAt,
    }));
    const r = state.searches.find(x => x.id === id);
    if (r && state.selectedSearchId === id && !state.previewId && r.matches[0]) set({ previewId: r.matches[0].items[0].id });
  }
}

export function stopSearch(id: string) { handles.get(id)?.stop(); }

export function removeSearch(id: string) {
  handles.get(id)?.stop();
  handles.delete(id);
  set(s => {
    const searches = s.searches.filter(r => r.id !== id);
    return { searches, selectedSearchId: s.selectedSearchId === id ? searches[0]?.id ?? null : s.selectedSearchId };
  });
}

export function clearFinished() {
  set(s => {
    const searches = s.searches.filter(r => r.status === 'running');
    return { searches, selectedSearchId: searches.some(r => r.id === s.selectedSearchId) ? s.selectedSearchId : searches[0]?.id ?? null };
  });
}

/** Run a restored (idle) or finished search again with its saved settings. */
export function rerunSearch(id: string) {
  const r = state.searches.find(x => x.id === id);
  if (!r) return;
  const request = buildRequest(state, r.settings.groupId, r.settings, r.target, r.originId, { maxResults: 50, timeLimitMs: 10_000 });
  if (typeof request === 'string') { notify('warn', request); return; }
  patchSearch(id, () => ({ status: 'running', reason: null, matches: [], nearest: null, progress: 0, startedAt: performance.now() }));
  set({ selectedSearchId: id });
  start(id, request);
}

export function selectSearch(id: string) {
  const r = state.searches.find(x => x.id === id);
  set({ selectedSearchId: id, previewId: r?.matches[0]?.items[0].id ?? null });
}

export function showPreview(amountId: string | null) { set({ previewId: amountId }); }

/** Clicking a number in a preview: search for it with the current settings. */
export function searchForAmount(amountId: string) {
  const hit = amountIndex().get(amountId);
  if (!hit) return;
  runSearch(formatMoney(hit.amount.value, hit.amount.decimals).replace('−', '-'), amountId);
}

// ---------- check a group ----------

export function openCheckSetup(open: boolean) { set({ checkSetupOpen: open }); }

export function startCheck(checkGroupId: string, againstGroupId: string, settings: Omit<FindSettings, 'groupId'>) {
  stopCheck();
  const checked = groupFiles(state, checkGroupId);
  if (!checked.length) { notify('warn', `${groupName(state, checkGroupId)} has no files yet.`); return; }
  const amounts = checked.flatMap(m => m.file.parsed?.amounts ?? []);
  const nonZero = amounts.filter(a => Math.abs(a.value) >= 0.005);
  const run: CheckRun = {
    id: uid('c'), checkGroupId, againstGroupId, settings,
    rows: nonZero.map(a => ({ amountId: a.id, status: 'pending', matches: [], nearest: null })),
    status: 'running', skippedZeros: amounts.length - nonZero.length,
  };
  set({ check: run, view: 'check', checkSetupOpen: false, previewId: nonZero[0]?.id ?? null });

  const budget = { maxResults: 3, timeLimitMs: settings.maxCount === null ? 3000 : 1500 };
  for (const a of nonZero) {
    const request = buildRequest(state, againstGroupId, settings, a.value, a.id, budget);
    if (typeof request === 'string') { notify('warn', request); stopCheck(); return; }
    const key = `${run.id}:${a.id}`;
    handles.set(key, getPool().run(request, ev => {
      if (ev.type !== 'done') return;
      handles.delete(key);
      const best = ev.matches[0];
      const status: RowStatus = !best ? 'notfound' : best.items.length === 1 ? 'found' : 'combo';
      set(s => {
        if (!s.check || s.check.id !== run.id) return {};
        const rows = s.check.rows.map(r => (r.amountId === a.id ? { ...r, status, matches: ev.matches, nearest: ev.nearest } : r));
        const done = rows.every(r => r.status !== 'pending');
        return { check: { ...s.check, rows, status: done && s.check.status === 'running' ? 'done' : s.check.status } };
      });
    }));
  }
}

export function stopCheck() {
  const run = state.check;
  if (!run) return;
  for (const [key, h] of handles) if (key.startsWith(`${run.id}:`)) { h.stop(); handles.delete(key); }
  if (run.status === 'running') set(s => ({ check: s.check && { ...s.check, status: 'stopped' } }));
}

export function closeCheck() { set({ view: 'workspace' }); }
export function openCheck() { if (state.check) set({ view: 'check' }); }
