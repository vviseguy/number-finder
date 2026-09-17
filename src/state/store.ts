// App state and actions. One module-level store read by React through useSyncExternalStore.
//
// Contracts:
//   - EVERYTHING LIVES IN MEMORY, and nothing is carried from one session to the next: not the files, not
//     short names, the file checklist, options, history, theme, pane width, or an opened folder. Every page load
//     starts from initialState(). lib/no-storage.ts turns the browser's storage off before this module
//     loads, and lib/no-storage.test.ts fails the build if code here reaches for it.
//   - File bytes live outside the state (fileData) so the state stays small.
//   - Nicknames and the file checklist reference files by key ("name|size"), so a file removed and dropped
//     in again during the same session keeps its short name and its tick.
//   - Where to search is a checklist of the files next to the search bar (find.scope): null means every
//     file, including files added later; otherwise the keys of the ticked files.
//   - The search bar starts runs. Each number typed is its own search; `check:1040` looks up every number
//     in the files named that way against the other ticked files (a check), and the other words are
//     filters. Words like in:, sums:, ±, neg override the pickers for that run.
//   - Versions are automatic: a query with the SAME NUMBER as an existing search (or the same files for a
//     check) becomes a new version of it; a different number is a new search; the identical definition
//     just shows the existing one. Any version can be viewed read-only or restored (as a newer version).

import { useSyncExternalStore } from 'react';
import type { Amount, DoneReason, EngineEvent, Match, ParsedFile, Rounding, SearchRequest } from '../types';
import { ROUNDING_TOLERANCE } from '../types';
import { extractFile } from '../extract';
import { SearchPool } from '../engine/pool';
import { forgetPdf, getPdfjs } from '../lib/pdf';
import { canOpenFolder, pickFolder, readFolder, type DirHandle } from '../lib/folder';
import {
  CHECK_SECONDS, DEFAULT_CHECK_SECONDS, DEFAULT_SEARCH_SECONDS, formatMoney, madeOfLabel, negativesLabel, plural, roundingPhrase, secondsLabel, uid,
} from '../lib/format';
import { checkToken, hasTerms, parseQuery, passesTerms, serializeTerms, termsPhrase, termText, type Query, type Terms } from '../lib/query';
import { DEFAULT_GROUPING, GROUPING_SHORT, groupingOf, sortMatches, type Grouping, type ItemInfo, type ResultSort } from '../lib/rank';
import { shortNames } from '../lib/names';

// These are read while this module loads (initialState below), so they must be declared before that line.
const READ_TIMEOUT_MS = 60_000;
export const MIN_PANE = 320;
const DEFAULT_PANE = 520;

// ---------- state shape ----------

export type Theme = 'system' | 'light' | 'dark';

export interface FileEntry {
  id: string;
  /** Identity that outlasts removing and re-adding the file this session: "name|size". */
  key: string;
  name: string;
  /** Short name shown in the interface; '' means use the file name (shortened automatically). */
  nick: string;
  size: number;
  status: 'reading' | 'ready' | 'error';
  parsed: ParsedFile | null;
  error?: string;
}

/**
 * scope is the files searched IN: null = every file (including files added later), otherwise the keys of the
 * ticked files. minCount (default 1) with maxCount = "sums of exactly N" or a range;
 * maxFlips (default no limit) caps how many numbers may count as negative; grouping is the search mode
 * for sums (default across files; see lib/rank.ts); tolerance, when set, replaces the rounding preset.
 */
export interface FindSettings {
  scope: string[] | null; maxCount: number | null; minCount?: number; rounding: Rounding; allowFlips: boolean; maxFlips?: number; grouping?: Grouping; tolerance?: number;
  /** How long a sum search may run, in seconds; null = no limit; undefined = the default. */
  seconds?: number | null;
  /** How long each number of a check may be searched, in seconds; undefined = the default. */
  checkSeconds?: number;
}

/** The search mode that applies to a run: only sums have one. */
const modeOf = (st: FindSettings): Grouping | undefined => (st.maxCount === 1 ? undefined : groupingOf(st));
export const searchSecondsOf = (st: FindSettings): number | null => (st.seconds === undefined ? DEFAULT_SEARCH_SECONDS : st.seconds);
export const checkSecondsOf = (st: FindSettings): number => st.checkSeconds ?? DEFAULT_CHECK_SECONDS;
/** "No limit" still needs a number for the engine: a day. */
const NO_LIMIT_MS = 86_400_000;

type RunStatus = 'running' | 'done' | 'stopped';

/** A frozen copy of a run as it was before a newer version replaced it. */
export interface Version { at: number; run: Run }

interface RunBase {
  id: string;
  settings: FindSettings;
  terms: Terms;
  status: RunStatus;
  startedAt: number;
  /** Wall-clock time this version was started. */
  at: number;
  elapsedMs: number;
  /** 1 for a fresh run; +1 per new version. */
  version: number;
  history: Version[];
  /** Index into history being viewed read-only, or null for the current version. */
  viewing: number | null;
}

export interface SearchRun extends RunBase {
  kind: 'search';
  target: number;
  targetDecimals: number;
  /** Set for a range search (3,200..3,300): target is the middle, the tolerance the half-width. */
  range: { lo: number; hi: number } | null;
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
  /** Keys of the files whose every number is checked, against the other files in settings.scope. */
  checkKeys: string[];
  rows: CheckRow[];
  skippedZeros: number;
  skippedByTerms: number;
  selectedAmountId: string | null;
}

export type Run = SearchRun | CheckRun;

export interface Notice { kind: 'info' | 'warn' | 'error'; text: string; action?: { label: string; run: () => void } }

/** The folder opened this session: being read, read, or unreadable (moved or renamed?). Forgotten with the tab. */
export interface FolderState { name: string; status: 'ready' | 'reading' | 'gone' }

export interface AppState {
  theme: Theme;
  /** Width of the right-hand pane in px. */
  paneWidth: number;
  files: FileEntry[];
  /** Nicknames by file key, kept for files that aren't loaded right now. */
  nicks: Record<string, string>;
  find: FindSettings;
  /** What's typed in the search bar. */
  findText: string;
  /** Bumped whenever the bar should take focus (new search). */
  barFocus: number;
  /** Order of a search's results. */
  resultSort: ResultSort;
  runs: Run[];
  selectedRunId: string | null;
  /** Amount shown in the side pane. */
  previewId: string | null;
  notice: Notice | null;
  dragging: boolean;
  folder: FolderState | null;
}

// ---------- store plumbing ----------

export const fileData = new Map<string, ArrayBuffer>();
const listeners = new Set<() => void>();
let state: AppState = initialState();
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
  const prev = state;
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  if (state.files !== prev.files) refreshLabels();
  emit();
}

export function getState(): AppState { return state; }

export function useAppState(): AppState {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}

// ---------- the starting state: the same on every page load ----------

// Function declarations, not consts: initialState() runs at module load, before consts below it exist.
function defaultFind(): FindSettings {
  return { scope: null, maxCount: 1, rounding: 'dollar', allowFlips: false, grouping: DEFAULT_GROUPING };
}

function initialState(): AppState {
  return {
    theme: 'system', paneWidth: DEFAULT_PANE, files: [], nicks: {}, find: defaultFind(), findText: '', barFocus: 0,
    resultSort: 'best', runs: [], selectedRunId: null, previewId: null, notice: null, dragging: false, folder: null,
  };
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
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

/**
 * The name shown in the interface: the nickname if one is set, otherwise the file name shortened to what
 * tells it apart from the other files (see lib/names.ts). Full names are always in tooltips and exports.
 */
let labels = new Map<string, string>();
function refreshLabels() {
  labels = shortNames(state.files.map(f => f.name));
}
export const fileLabel = (f: { nick: string; name: string }) => f.nick || labels.get(f.name) || f.name;

/** Text the filters are matched against for a file: its name and nickname. */
export const fileTermText = (f: FileEntry) => `${f.name} ${f.nick}`;

/** The loaded files in a scope (null = every file), leaving out the `skip` keys; only readable ones unless `anyStatus`. */
export function scopeFiles(s: AppState, scope: string[] | null, skip: string[] = [], anyStatus = false): FileEntry[] {
  return s.files.filter(f => (anyStatus || (f.status === 'ready' && !!f.parsed)) && (scope === null || scope.includes(f.key)) && !skip.includes(f.key));
}

/** Every amount in a scope's readable files. */
export function scopeAmounts(s: AppState, scope: string[] | null, skip: string[] = []): Amount[] {
  return scopeFiles(s, scope, skip).flatMap(f => f.parsed?.amounts ?? []);
}

/** For sentences: "all files", "W-2.pdf", "W-2.pdf and 1099-INT.pdf", "4 files", "the other 4 files", "no files". */
export function scopePhrase(s: AppState, scope: string[] | null, skip: string[] = []): string {
  if (scope === null && !skip.length) return 'all files';
  const files = scopeFiles(s, scope, skip, true);
  if (!files.length) return 'no files';
  if (files.length === 1) return fileLabel(files[0]);
  if (files.length === 2) return `${fileLabel(files[0])} and ${fileLabel(files[1])}`;
  return scope === null ? `the other ${plural(files.length, 'file')}` : plural(files.length, 'file');
}

/** The keys of the files a check looks its numbers up in: the scope without the checked files. */
export function againstKeys(s: AppState, run: CheckRun): string[] {
  return scopeFiles(s, run.settings.scope, run.checkKeys, true).map(f => f.key);
}

/**
 * Files named in the bar (in:, check:), case-insensitively, by file name (with or without its extension) or
 * short name: the files named exactly that, else every file whose name starts with it, else every file whose
 * name contains it. So in:1099 is both 1099s.
 */
export function filesByText(s: AppState, text: string): FileEntry[] {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const names = (f: FileEntry) => [f.name, f.name.replace(/\.[^.]+$/, ''), fileLabel(f), f.nick].filter(Boolean).map(n => n.toLowerCase());
  for (const fits of [(n: string) => n === t, (n: string) => n.startsWith(t), (n: string) => n.includes(t)]) {
    const found = s.files.filter(f => names(f).some(fits));
    if (found.length) return found;
  }
  return [];
}

export const keysOf = (files: FileEntry[]): string[] => [...new Set(files.map(f => f.key))];

/** "No file is called “x”. Files: W-2.pdf, 1099-INT.pdf, and 3 more." */
export function noFileMessage(s: AppState, text: string): string {
  if (!s.files.length) return `No file is called “${text}”: no files are added yet.`;
  const names = s.files.map(f => fileLabel(f));
  const list = names.length > 4 ? `${names.slice(0, 3).join(', ')}, and ${names.length - 3} more` : names.join(', ');
  return `No file is called “${text}”. Files: ${list}.`;
}

/** A file key's name ("name|size"), for files no longer loaded. */
const nameOfKey = (s: AppState, key: string) => s.files.find(f => f.key === key)?.name ?? key.slice(0, key.lastIndexOf('|'));

/** "in all files · sums of up to 3, across files · whole dollars · negatives · 2 min limit · skipping “hours”" */
export function runSummary(s: AppState, r: { settings: FindSettings; terms: Terms; kind?: Run['kind']; checkKeys?: string[] }): string {
  const st = r.settings;
  const mode = modeOf(st);
  const parts = [`in ${scopePhrase(s, st.scope, r.kind === 'check' ? r.checkKeys : [])}`, `${madeOfLabel(st.maxCount, st.minCount)}${mode ? `, ${GROUPING_SHORT[mode]}` : ''}`, roundingPhrase(st.rounding, st.tolerance)];
  const neg = negativesLabel(st.allowFlips, st.maxFlips);
  if (neg) parts.push(neg);
  if (st.maxCount !== 1) {
    if (r.kind === 'check') { if (checkSecondsOf(st) !== DEFAULT_CHECK_SECONDS) parts.push(`${secondsLabel(checkSecondsOf(st))} per number`); }
    else if (searchSecondsOf(st) === null) parts.push('no time limit');
    else if (searchSecondsOf(st) !== DEFAULT_SEARCH_SECONDS) parts.push(`${secondsLabel(searchSecondsOf(st))} limit`);
  }
  const t = termsPhrase(r.terms);
  if (t) parts.push(t);
  return parts.join(' · ');
}

/** "3,235" or "3,200..3,300". */
export function targetText(r: SearchRun): string {
  return r.range ? `${formatMoney(r.range.lo, r.targetDecimals)}..${formatMoney(r.range.hi, r.targetDecimals)}` : formatMoney(r.target, r.targetDecimals);
}

/** The run as shown: a past version when one is being viewed, else the run itself. */
export function shownRun(r: Run): { run: Run; past: boolean } {
  const v = r.viewing !== null ? r.history[r.viewing] : undefined;
  return v ? { run: v.run, past: true } : { run: r, past: false };
}

/** What the result order needs to know about a number: its file's order, its position, and its text. */
function itemInfo(s: AppState, id: string): ItemInfo | undefined {
  const hit = amountIndex(s).get(id);
  if (!hit) return undefined;
  const loc = hit.amount.location;
  return {
    fileOrder: s.files.indexOf(hit.file),
    position: Number(id.slice(id.lastIndexOf(':') + 1)) || 0,
    section: loc.kind === 'pdf' ? `p${loc.page}` : loc.sheet,
    fileLabel: fileLabel(hit.file),
    text: termText(hit.amount, fileTermText(hit.file)),
  };
}

let sortCache: { s: AppState; r: SearchRun; sort: ResultSort; out: Match[] } | null = null;

/** A search's matches in the chosen order (see lib/rank.ts). Cached for the last run shown. */
export function sortedMatches(s: AppState, r: SearchRun): Match[] {
  if (sortCache && sortCache.s === s && sortCache.r === r && sortCache.sort === s.resultSort) return sortCache.out;
  const out = sortMatches(r.matches, s.resultSort, r.terms, id => itemInfo(s, id), modeOf(r.settings));
  sortCache = { s, r, sort: s.resultSort, out };
  return out;
}

export function setResultSort(resultSort: ResultSort) {
  if (resultSort === state.resultSort) return;
  set({ resultSort });
}

// ---------- notices, layout ----------

export function notify(kind: Notice['kind'], text: string, action?: Notice['action']) {
  clearTimeout(noticeTimer);
  set({ notice: { kind, text, action } });
  noticeTimer = setTimeout(() => set({ notice: null }), kind === 'error' ? 8000 : 6000);
}
export function dismissNotice() { clearTimeout(noticeTimer); set({ notice: null }); }

export function setTheme(theme: Theme) {
  applyTheme(theme);
  set({ theme });
}

export function setPaneWidth(px: number) {
  const width = Math.round(Math.max(MIN_PANE, px));
  if (width === state.paneWidth) return;
  set({ paneWidth: width });
}

// ---------- files ----------

const fileKey = (f: { name: string; size: number }) => `${f.name}|${f.size}`;

/** A file that never finishes reading must say so instead of showing "Reading…" forever. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

/** Adds documents. Returns how many were new. */
export async function addFiles(list: File[], quietDupes = false): Promise<number> {
  const fresh = list.filter(f => !state.files.some(e => e.key === fileKey(f)));
  const dupes = list.length - fresh.length;
  if (dupes && !quietDupes) notify('info', dupes === 1 ? `${list.find(f => state.files.some(e => e.key === fileKey(f)))?.name} is already added.` : `${dupes} files were already added.`);
  const entries: FileEntry[] = fresh.map(f => ({
    id: uid('f'), key: fileKey(f), name: f.name, nick: state.nicks[fileKey(f)] ?? '', size: f.size, status: 'reading', parsed: null,
  }));
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
  const problems = state.files.filter(f => entries.some(e => e.id === f.id) && (f.status === 'error' || !!f.parsed?.warnings.length));
  if (problems.length === 1) notify('warn', `${problems[0].name}: ${problems[0].error ?? problems[0].parsed?.warnings[0]}`);
  else if (problems.length > 1) notify('warn', `${plural(problems.length, 'file')} need a look: ${problems.map(f => f.name).join(', ')}. The file list next to the search bar says why.`);
  return entries.length;
}

// ---------- open a folder (Chromium; this session only) ----------

const FOLDER_EXTENSIONS = ['.pdf', '.xlsx', '.xlsm', '.xls', '.ods', '.csv', '.tsv', '.txt'];
/** The folder opened this session, held in memory only so "Read again" can pick up new or changed files. */
let openedFolder: DirHandle | null = null;

async function readFromFolder(h: DirHandle) {
  set({ folder: { name: h.name, status: 'reading' } });
  try {
    const files = await readFolder(h, FOLDER_EXTENSIONS);
    set({ folder: { name: h.name, status: 'ready' } });
    if (!files.length) { notify('warn', `There are no PDF, Excel, or CSV files in ${h.name}.`); return; }
    const added = await addFiles(files, true);
    if (state.notice?.kind !== 'warn') notify('info', added ? `Read ${plural(added, 'file')} from ${h.name}.` : `The ${plural(files.length, 'file')} in ${h.name} were already added.`);
  } catch (err) {
    console.error(err);
    set({ folder: { name: h.name, status: 'gone' } });
    notify('error', `Couldn't read the folder ${h.name}. Was it moved or renamed?`);
  }
}

/** "Open folder": pick a folder and read its documents. */
export async function openFolder() {
  if (!canOpenFolder) return;
  const h = await pickFolder();
  if (!h) return;
  openedFolder = h;
  await readFromFolder(h);
}

/** "Read again": the folder opened this session, for files added or changed since. */
export async function rereadFolder() {
  if (openedFolder) await readFromFolder(openedFolder);
}

function updateFile(id: string, patch: Partial<FileEntry>) {
  set(s => ({ files: s.files.map(f => (f.id === id ? { ...f, ...patch } : f)) }));
}

export function setNick(id: string, nick: string) {
  const f = state.files.find(x => x.id === id);
  if (!f) return;
  const clean = nick.trim() === f.name ? '' : nick.trim();
  set(s => ({
    files: s.files.map(x => (x.id === id ? { ...x, nick: clean } : x)),
    nicks: clean ? { ...s.nicks, [f.key]: clean } : Object.fromEntries(Object.entries(s.nicks).filter(([k]) => k !== f.key)),
  }));
}

export function removeFile(id: string) {
  const f = state.files.find(x => x.id === id);
  if (!f) return;
  fileData.delete(id);
  forgetPdf(id);
  set(s => ({
    files: s.files.filter(x => x.id !== id),
    previewId: s.previewId && s.previewId.startsWith(`${id}:`) ? null : s.previewId,
  }));
}

export function setDragging(dragging: boolean) { if (state.dragging !== dragging) set({ dragging }); }

// ---------- which files to search ----------

/** "Select all" (null: every file, including files added later) or "Select none" ([]). */
export function setScope(scope: string[] | null) { setFind({ scope }); }

/** Tick or untick one file. Ticking the last unticked file goes back to "every file". */
export function toggleScopeFile(key: string) {
  const all = keysOf(state.files);
  const current = state.find.scope ?? all;
  const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
  setScope(all.every(k => next.includes(k)) ? null : next);
}

/** Show a file in the side pane, at its first number. */
export function showFile(id: string) {
  const first = state.files.find(f => f.id === id)?.parsed?.amounts[0];
  if (first) set({ previewId: first.id });
}

// ---------- the search bar ----------

export function setFind(patch: Partial<FindSettings>) { set(s => ({ find: { ...s.find, ...patch } })); }
export function setFindText(findText: string) { set({ findText }); }
export function clearFindText() { set({ findText: '' }); }

/** An empty bar: the history (or a prompt to add files) with nothing selected. */
export function newSearch() {
  set(s => ({ findText: '', selectedRunId: null, previewId: null, barFocus: s.barFocus + 1 }));
}

/**
 * "Check every number" on a file in the file list: adds check:"file" to the bar, after any files already
 * there, keeps the filter words, and puts the cursor in the bar so the person can adjust and press Enter.
 */
export function checkFile(key: string) {
  const f = state.files.find(x => x.key === key);
  if (!f) return;
  const q = parseQuery(state.findText);
  const already = keysOf(q.checkFiles.flatMap(text => filesByText(state, text)));
  const checks = [...q.checkFiles.map(checkToken), ...(already.includes(key) ? [] : [checkToken(f.name)])];
  set(s => ({
    findText: [...checks, serializeTerms(q.terms)].filter(Boolean).join(' '),
    selectedRunId: null,
    previewId: null,
    barFocus: s.barFocus + 1,
  }));
}

/**
 * The settings a search from the bar would use: the file list and option pills, with the bar's words (in:,
 * sums:, neg, mode:, time:, ±) laid over them. An in: that names no file is left out (submitFind reports
 * it). Used by Search and by the size note under the bar, so both see the same search.
 */
export function settingsFor(s: AppState, q: Query): FindSettings {
  const { tolerance: _drop, ...rest } = s.find;
  void _drop;
  const st: FindSettings = { ...rest };
  if (q.inFiles.length) { const keys = keysOf(q.inFiles.flatMap(text => filesByText(s, text))); if (keys.length) st.scope = keys; }
  if (q.maxCount !== undefined) { st.maxCount = q.maxCount; st.minCount = q.minCount; }
  if (q.negatives !== undefined) { st.allowFlips = q.negatives; st.maxFlips = q.negatives ? q.maxFlips : undefined; }
  if (q.grouping !== undefined) st.grouping = q.grouping;
  if (q.seconds !== undefined) {
    // In a check the time is per number, so "no limit" becomes the longest per-number choice.
    if (q.checkFiles.length) st.checkSeconds = q.seconds ?? CHECK_SECONDS[CHECK_SECONDS.length - 1];
    else st.seconds = q.seconds;
  }
  if (q.tolerance !== undefined) st.tolerance = q.tolerance;
  return st;
}

function currentSettings(): FindSettings {
  return settingsFor(state, parseQuery(''));
}

/** What the search bar shows for a run: its number(s) or check:"file" words, and its filter words. */
function queryTextOf(r: Run): string {
  const head = r.kind === 'search' ? targetText(r).replace(/−/g, '-') : r.checkKeys.map(k => checkToken(nameOfKey(state, k))).join(' ');
  return [head, serializeTerms(r.terms)].filter(Boolean).join(' ');
}

/** Put a run's query and settings into the search bar (selecting it does this, like an address bar). */
function loadIntoBar(r: Run) {
  set({ find: r.settings, findText: queryTextOf(r) });
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every(w => b.includes(w));
const sameTerms = (a: Terms, b: Terms) =>
  sameList(a.include, b.include) && sameList(a.exclude, b.exclude) && sameList(a.fuzzy, b.fuzzy) && sameList(a.prefer, b.prefer);
const sameScope = (a: string[] | null, b: string[] | null) => (a === null || b === null ? a === b : sameList(a, b));
const sameSettings = (a: FindSettings, b: FindSettings) =>
  sameScope(a.scope, b.scope) && a.maxCount === b.maxCount && (a.minCount ?? 1) === (b.minCount ?? 1) && a.rounding === b.rounding
  && a.allowFlips === b.allowFlips && (a.maxFlips ?? -1) === (b.maxFlips ?? -1) && (a.tolerance ?? -1) === (b.tolerance ?? -1)
  && modeOf(a) === modeOf(b)
  && (a.maxCount === 1 || (searchSecondsOf(a) === searchSecondsOf(b) && checkSecondsOf(a) === checkSecondsOf(b)));
const close = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** The search for this number (or range), whichever version it's on. */
function searchFor(target: number, range: { lo: number; hi: number } | null): SearchRun | undefined {
  return state.runs.find((r): r is SearchRun => r.kind === 'search'
    && (range ? !!r.range && close(r.range.lo, range.lo) && close(r.range.hi, range.hi) : !r.range && close(r.target, target)));
}

const checkFor = (checkKeys: string[]) => state.runs.find((r): r is CheckRun => r.kind === 'check' && sameList(r.checkKeys, checkKeys));

/**
 * Enter in the search bar. Each number is its own search (they share filters and settings); a range
 * (3,200..3,300) is a search too. `check:1040` looks up every number in the files named that way instead,
 * against the other ticked files, with the bar's words as filters. Same number as an existing search → a new version of it (or just show it,
 * if nothing changed). The query stays in the bar afterwards.
 */
export function submitFind(): boolean {
  const q = parseQuery(state.findText);
  if (q.errors.length) { notify('error', q.errors[0]); return false; }
  if (!state.findText.trim()) { newSearch(); return true; }
  const unknown = [...q.inFiles, ...q.checkFiles].find(text => !filesByText(state, text).length);
  if (unknown !== undefined) { notify('error', noFileMessage(state, unknown)); return false; }
  const settings = settingsFor(state, q);

  if (q.checkFiles.length) {
    const checkKeys = keysOf(q.checkFiles.flatMap(text => filesByText(state, text)));
    if (q.numbers.length || q.range) {
      notify('warn', `check: looks up every number in ${scopePhrase(state, checkKeys)}, so leave the numbers out — or take check: away to search for ${q.numbers[0]?.text ?? q.range?.text}.`);
      return false;
    }
    const existing = checkFor(checkKeys);
    if (existing && sameTerms(existing.terms, q.terms) && sameSettings(existing.settings, settings)) {
      selectRun(existing.id);
      notify('info', 'That check is already in the history; showing it.');
      return true;
    }
    return existing ? replaceCheck(existing, checkKeys, settings, q.terms) : startCheck(checkKeys, settings, q.terms);
  }

  const targets: { value: number; decimals: number; range: { lo: number; hi: number } | null; text: string }[] = q.numbers.map(n => ({ value: n.value, decimals: n.decimals, range: null, text: n.text }));
  if (q.range) {
    const decimals = Math.max(decimalsOf(q.range.text.split('..')[0]), decimalsOf(q.range.text.split('..')[1]));
    targets.push({ value: (q.range.lo + q.range.hi) / 2, decimals, range: q.range, text: q.range.text });
  }
  if (!targets.length) {
    notify('error', 'Type a number to find, like 3,235, or a range like 3,200..3,300. Filter words on their own need a number.');
    return false;
  }

  let firstId: string | null = null;
  let versions = 0;
  let fresh = 0;
  for (const t of targets) {
    const existing = searchFor(t.value, t.range);
    if (existing) {
      if (sameTerms(existing.terms, q.terms) && sameSettings(existing.settings, settings)) {
        firstId ??= existing.id;
        if (targets.length === 1) { selectRun(existing.id); notify('info', 'That search is already in the history; showing it.'); }
        continue;
      }
      if (replaceSearch(existing, t.value, t.decimals, t.range, q.terms, settings)) { versions++; firstId ??= existing.id; }
    } else if (runSearch(t.value, t.decimals, t.range, q.terms, null, settings)) {
      fresh++;
      firstId ??= state.runs[0].id;
    }
  }
  if (firstId) set({ selectedRunId: firstId });
  if (targets.length > 1 && (fresh || versions)) {
    notify('info', [fresh && `${fresh} new ${fresh === 1 ? 'search' : 'searches'}`, versions && `${versions} new ${versions === 1 ? 'version' : 'versions'}`].filter(Boolean).join(' · ') + '.');
  } else if (versions === 1 && fresh === 0) {
    const r = state.runs.find(x => x.id === firstId);
    if (r) notify('info', `Version ${r.version} of the search for ${targets[0].text}.`);
  }
  return !!firstId;
}

const decimalsOf = (t: string) => { const m = /\.(\d+)/.exec(t); return m ? m[1].length : 0; };

function buildRequest(
  s: AppState,
  settings: FindSettings,
  target: number,
  exclude: string | null,
  terms: Terms,
  budget: { maxResults: number; timeLimitMs: number },
  range: { lo: number; hi: number } | null = null,
  /** Files left out of the search: a check's own files. */
  skip: string[] = [],
): SearchRequest | string {
  const files = scopeFiles(s, settings.scope, skip);
  if (!files.length) {
    if (!s.files.length) return 'Add some files first.';
    if (settings.scope?.length === 0) return 'No files are ticked. Pick the files to search in the file list next to the search bar.';
    if (skip.length && !scopeFiles(s, settings.scope, skip, true).length) {
      return `There are no other files to check ${scopePhrase(s, skip)} against. Tick more files in the file list next to the search bar.`;
    }
    return 'None of the files to search can be read yet: they are still being read, or could not be read.';
  }
  const where = scopePhrase(s, settings.scope, skip);
  const candidates = files.flatMap(f => (f.parsed?.amounts ?? [])
    .filter(a => a.id !== exclude && passesTerms(a, fileTermText(f), terms))
    .map(a => ({ id: a.id, fileId: a.fileId, value: a.value })));
  if (!candidates.length) {
    return hasTerms(terms)
      ? `No numbers in ${where} are left after the filters (${termsPhrase(terms)}).`
      : `There are no numbers in ${where} to search.`;
  }
  return {
    target,
    minCount: range ? 1 : Math.min(settings.minCount ?? 1, settings.maxCount ?? Infinity),
    maxCount: range ? 1 : settings.maxCount,
    allowFlips: settings.allowFlips,
    maxFlips: settings.allowFlips ? settings.maxFlips ?? null : null,
    tolerance: range ? (range.hi - range.lo) / 2 : settings.tolerance ?? ROUNDING_TOLERANCE[settings.rounding],
    candidates,
    limits: {},
    ...budget,
  };
}

// ---------- single searches ----------

// Sums collect more matches than they show first, so the search mode has real choices to put on top,
// and run for the time limit the person chose (single numbers finish at once).
const SEARCH_BUDGET = { maxResults: 50, timeLimitMs: 10_000 };
export const SUM_MAX_RESULTS = 150;
function budgetFor(st: FindSettings) {
  if (st.maxCount === 1) return SEARCH_BUDGET;
  const sec = searchSecondsOf(st);
  return { maxResults: SUM_MAX_RESULTS, timeLimitMs: sec === null ? NO_LIMIT_MS : sec * 1000 };
}

const snapshot = (r: Run): Version => ({ at: r.at, run: { ...r, history: [], viewing: null } });

export function runSearch(
  target: number, decimals: number, range: { lo: number; hi: number } | null, terms: Terms, originId: string | null,
  settings: FindSettings = currentSettings(),
): boolean {
  const request = buildRequest(state, settings, target, originId, terms, budgetFor(settings), range);
  if (typeof request === 'string') { notify('warn', request); return false; }
  const run: SearchRun = {
    kind: 'search', id: uid('s'), target, targetDecimals: decimals, range, originId, settings, terms, status: 'running', reason: null,
    matches: [], progress: 0, startedAt: performance.now(), at: Date.now(), elapsedMs: 0, version: 1, history: [], viewing: null,
  };
  set(s => ({ runs: [run, ...s.runs], selectedRunId: run.id, previewId: null, findText: queryTextOf(run), find: settings }));
  startSearch(run.id, request);
  return true;
}

/** A new version of an existing search: the old one goes into its history. */
function replaceSearch(old: SearchRun, target: number, decimals: number, range: { lo: number; hi: number } | null, terms: Terms, settings: FindSettings): boolean {
  const request = buildRequest(state, settings, target, old.originId, terms, budgetFor(settings), range);
  if (typeof request === 'string') { notify('warn', request); return false; }
  handles.get(old.id)?.stop();
  handles.delete(old.id);
  patchRun(old.id, r => ({
    target, targetDecimals: decimals, range, terms, settings, status: 'running', reason: null, matches: [], progress: 0,
    startedAt: performance.now(), at: Date.now(), elapsedMs: 0, version: r.version + 1, history: [...r.history, snapshot(r)], viewing: null,
  }));
  set({ selectedRunId: old.id, previewId: null, find: settings, findText: queryTextOf({ ...old, target, targetDecimals: decimals, range, terms }) });
  startSearch(old.id, request);
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
    if (r?.kind === 'search' && state.selectedRunId === id && !state.previewId && r.matches[0]) set({ previewId: sortedMatches(state, r)[0].items[0].id });
  }
}

/** Clicking a number in a preview: search for it with the bar's current filters and settings. */
export function searchForAmount(amountId: string) {
  const hit = amountIndex().get(amountId);
  if (!hit) return;
  const existing = searchFor(hit.amount.value, null);
  if (existing) { selectRun(existing.id); return; }
  runSearch(hit.amount.value, hit.amount.decimals, null, parseQuery(state.findText).terms, amountId);
}

/** A new version of a search with wider settings (from the "try …" buttons under a miss). */
export function retryWith(runId: string, patch: Partial<FindSettings>) {
  const r = state.runs.find(x => x.id === runId);
  if (!r || r.kind !== 'search') return;
  const settings = { ...r.settings, ...patch };
  if ('rounding' in patch) delete settings.tolerance;
  replaceSearch(r, r.target, r.targetDecimals, r.range, r.terms, settings);
}

// ---------- checking every number in some files ----------

export function startCheck(checkKeys: string[], settings: FindSettings, terms: Terms): boolean {
  const run: CheckRun = {
    kind: 'check', id: uid('c'), checkKeys, settings, terms, status: 'running', rows: [], skippedZeros: 0, skippedByTerms: 0,
    selectedAmountId: null, startedAt: performance.now(), at: Date.now(), elapsedMs: 0, version: 1, history: [], viewing: null,
  };
  return launchCheck(run, true);
}

function replaceCheck(old: CheckRun, checkKeys: string[], settings: FindSettings, terms: Terms): boolean {
  stopRun(old.id);
  const current = state.runs.find(r => r.id === old.id) as CheckRun | undefined;
  if (!current) return false;
  return launchCheck({ ...current, checkKeys, settings, terms, version: current.version + 1, history: [...current.history, snapshot(current)], viewing: null }, false);
}

function launchCheck(base: CheckRun, isNew: boolean): boolean {
  const checked = scopeFiles(state, base.checkKeys);
  if (!checked.length) { notify('warn', `${scopePhrase(state, base.checkKeys)} can't be checked: it isn't read yet, or couldn't be read.`); return false; }
  const all = checked.flatMap(f => (f.parsed?.amounts ?? []).map(a => ({ a, text: fileTermText(f) })));
  const kept = all.filter(x => passesTerms(x.a, x.text, base.terms)).map(x => x.a);
  const nonZero = kept.filter(a => Math.abs(a.value) >= 0.005);
  if (!nonZero.length) {
    notify('warn', `There are no numbers to check in ${scopePhrase(state, base.checkKeys)}${hasTerms(base.terms) ? ' after the filters' : ''}.`);
    return false;
  }
  const probe = buildRequest(state, base.settings, 1, null, base.terms, { maxResults: 1, timeLimitMs: 1 }, null, base.checkKeys);
  if (typeof probe === 'string') { notify('warn', probe); return false; }

  const run: CheckRun = {
    ...base,
    status: 'running',
    rows: nonZero.map(a => ({ amountId: a.id, status: 'pending', matches: [] })),
    skippedZeros: kept.length - nonZero.length,
    skippedByTerms: all.length - kept.length,
    selectedAmountId: null, // until a row is picked, the table's first row is shown
    startedAt: performance.now(),
    at: Date.now(),
    elapsedMs: 0,
  };
  set(s => ({
    runs: isNew ? [run, ...s.runs] : s.runs.map(r => (r.id === run.id ? run : r)),
    selectedRunId: run.id,
    previewId: null,
    find: run.settings,
    findText: queryTextOf(run),
  }));

  // A row keeps its best 3 matches; sums collect a few more first so the search mode can choose among them.
  const budget = base.settings.maxCount === 1
    ? { maxResults: CHECK_KEEP, timeLimitMs: 1500 }
    : { maxResults: 12, timeLimitMs: checkSecondsOf(base.settings) * 1000 };
  for (const a of nonZero) {
    const request = buildRequest(state, base.settings, a.value, a.id, base.terms, budget, null, base.checkKeys);
    if (typeof request === 'string') { onCheckRow(run.id, a.id, []); continue; }
    const key = `${run.id}:${a.id}`;
    handles.set(key, getPool().run(request, ev => {
      if (ev.type !== 'done' || ev.reason === 'stopped') return;
      onCheckRow(run.id, a.id, ev.matches);
    }));
  }
  return true;
}

const CHECK_KEEP = 3;

function onCheckRow(runId: string, amountId: string, found: Match[]) {
  handles.delete(`${runId}:${amountId}`);
  const run = state.runs.find(r => r.id === runId);
  const matches = run && found.length > 1
    ? sortMatches(found, 'best', run.terms, id => itemInfo(state, id), modeOf(run.settings)).slice(0, CHECK_KEEP)
    : found.slice(0, CHECK_KEEP);
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

// ---------- history ----------

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

/** Run a finished or stopped run again with the same settings and filters. */
export function rerunRun(id: string) {
  const r = state.runs.find(x => x.id === id);
  if (!r) return;
  stopRun(id);
  if (r.kind === 'check') { launchCheck({ ...r, viewing: null }, false); return; }
  const request = buildRequest(state, r.settings, r.target, r.originId, r.terms, budgetFor(r.settings), r.range);
  if (typeof request === 'string') { notify('warn', request); return; }
  patchRun(id, () => ({ status: 'running', reason: null, matches: [], progress: 0, startedAt: performance.now(), at: Date.now(), viewing: null }));
  set({ selectedRunId: id, previewId: null });
  startSearch(id, request);
}

/** Show a past version read-only (index into history), or null for the current one. */
export function viewVersion(id: string, viewing: number | null) {
  patchRun(id, () => ({ viewing }));
  set({ selectedRunId: id, previewId: null });
}

/** Run a past version again as the newest version (the current one is kept in history). */
export function restoreVersion(id: string, index: number) {
  const r = state.runs.find(x => x.id === id);
  const v = r?.history[index]?.run;
  if (!r || !v) return;
  if (r.kind === 'search' && v.kind === 'search') replaceSearch(r, v.target, v.targetDecimals, v.range, v.terms, v.settings);
  else if (r.kind === 'check' && v.kind === 'check') replaceCheck(r, v.checkKeys, v.settings, v.terms);
}

/** Show a run's results and put its query back into the search bar. */
export function selectRun(id: string) {
  const r = state.runs.find(x => x.id === id);
  if (!r) return;
  const shown = shownRun(r).run;
  const previewId = shown.kind === 'search' ? sortedMatches(state, shown)[0]?.items[0].id ?? null : shown.selectedAmountId ?? shown.rows[0]?.amountId ?? null;
  loadIntoBar(r);
  set({ selectedRunId: id, previewId });
}

export function showPreview(amountId: string | null) { set({ previewId: amountId }); }
