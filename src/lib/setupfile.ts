// The setup as a file: groups, short names, the bar's options, the order of results, and the searches
// (their definitions, not their results). Saved as "Number finder setup.json"; loading one, or dropping
// it on the page, replaces the current setup. The same shape is what's kept in localStorage.

import type { Rounding } from '../types';
import type { Terms } from './query';
import type { ResultSort } from './rank';

export interface SavedGroup { id: string; name: string; color: number; members: { key: string; name: string; limit: string }[] }
export interface SavedFind { groupId: string; maxCount: number | null; rounding: Rounding; allowFlips: boolean; tolerance?: number }
export type SavedRun =
  | { kind: 'search'; target: number; targetDecimals: number; range: { lo: number; hi: number } | null; settings: SavedFind; terms: Terms }
  | { kind: 'check'; checkGroupId: string; settings: SavedFind; terms: Terms };

export interface SavedSetup {
  groups: SavedGroup[];
  nicks: Record<string, string>;
  find: SavedFind;
  resultSort?: ResultSort;
  runs: SavedRun[];
  /** Name of the folder the files came from, when one was opened (the folder itself can't be saved in a file). */
  folder?: string;
}

export const SETUP_FILE_NAME = 'Number finder setup.json';

interface SetupFile { app: 'number-finder'; version: 1; savedAt: string; setup: SavedSetup }

export function serializeSetup(setup: SavedSetup): string {
  const file: SetupFile = { app: 'number-finder', version: 1, savedAt: new Date().toISOString(), setup };
  return JSON.stringify(file, null, 2);
}

/** Looks like one of ours? (Cheap check so a random .json dropped on the page gets a clear message.) */
export function isSetupText(text: string): boolean {
  return /"app"\s*:\s*"number-finder"/.test(text.slice(0, 2000));
}

/** Parse a setup file; throws an Error with a plain-language message when it isn't one. */
export function parseSetup(text: string): { setup: SavedSetup; savedAt: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("This isn't a Number finder setup file (it isn't valid JSON)."); }
  const f = raw as Partial<SetupFile>;
  if (!f || typeof f !== 'object' || f.app !== 'number-finder' || !f.setup || typeof f.setup !== 'object') {
    throw new Error("This isn't a Number finder setup file.");
  }
  if (f.version !== 1) throw new Error(`This setup file is version ${String(f.version)}, which this copy of Number finder can't read.`);
  const s = f.setup;
  const setup: SavedSetup = {
    groups: Array.isArray(s.groups) ? s.groups.filter(g => g && typeof g.id === 'string' && typeof g.name === 'string').map(g => ({ ...g, members: Array.isArray(g.members) ? g.members : [] })) : [],
    nicks: s.nicks && typeof s.nicks === 'object' ? s.nicks : {},
    find: s.find && typeof s.find === 'object' ? s.find : { groupId: '__all__', maxCount: 1, rounding: 'dollar', allowFlips: false },
    resultSort: s.resultSort,
    runs: Array.isArray(s.runs) ? s.runs.filter(r => r && (r.kind === 'search' || r.kind === 'check')) : [],
    folder: typeof s.folder === 'string' ? s.folder : undefined,
  };
  return { setup, savedAt: typeof f.savedAt === 'string' ? f.savedAt : '' };
}
