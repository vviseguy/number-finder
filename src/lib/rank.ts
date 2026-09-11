// Orders for search results. The engine reports matches as it finds them (single numbers first, then
// pairs, and so on); these put them in the order the user asked for.
//
//   best      single numbers first; then the ones that mention a 'preferred word; then, for sums, the
//             search mode (below); then fewest numbers, fewest negatives, closest to the target,
//             document order
//   closest   smallest difference from the target first, then as "best"
//   file      by file (as shown), then position in the file
//   position  document order: files in the order they were added, then position in the file
//
// Search mode (sums only) — which groupings of numbers come first:
//   clumped   numbers from one file, on one page or sheet, next to each other
//   spread    numbers from one file, but far apart in it (different pages or sheets, distant rows)
//   across    one number from each file, like a return line built from several source documents

import type { Match } from '../types';
import { preferHits, type Terms } from './query';

export type ResultSort = 'best' | 'closest' | 'file' | 'position';

export const SORT_LABEL: Record<ResultSort, string> = {
  best: 'Best match',
  closest: 'Closest first',
  file: 'By file',
  position: 'Document order',
};

export const SORTS = Object.keys(SORT_LABEL) as ResultSort[];

export type Grouping = 'clumped' | 'spread' | 'across';

export const GROUPINGS: Grouping[] = ['clumped', 'spread', 'across'];
export const GROUPING_LABEL: Record<Grouping, string> = { clumped: 'Clumped', spread: 'Spread (within files)', across: 'Across files' };
/** For summaries and the pill: "across files". */
export const GROUPING_SHORT: Record<Grouping, string> = { clumped: 'clumped', spread: 'spread within files', across: 'across files' };
export const GROUPING_HINT =
  'Which sums come first. Clumped: numbers next to each other in one file. Spread: one file, numbers far apart. Across files: one number from each file, like a return line built from several source documents.';

export const DEFAULT_GROUPING: Grouping = 'across';
export const groupingOf = (s: { grouping?: Grouping }): Grouping => s.grouping ?? DEFAULT_GROUPING;

/** What the ranking needs to know about one number. */
export interface ItemInfo {
  /** Order the file was added in. */
  fileOrder: number;
  /** Index within the file, in reading order. */
  position: number;
  /** Page or sheet within the file ('' when unknown). */
  section?: string;
  /** The file's name as shown. */
  fileLabel: string;
  /** Lower-case label + file name + sheet, as the filters see it. */
  text: string;
}

interface Key { single: number; count: number; prefers: number; group: number; flips: number; diff: number; fileOrder: number; position: number; fileLabel: string }

// Weights keep the parts of a score apart: files outrank pages/sheets, which outrank distance within one.
const FILE = 1e9;
const SECTION = 1e6;

/** Lower is better. 0 for single numbers and when no mode applies. */
function groupScore(m: Match, grouping: Grouping | undefined, info: (id: string) => ItemInfo | undefined): number {
  if (!grouping || m.items.length < 2) return 0;
  const files = new Set<number>();
  const sections = new Map<string, { lo: number; hi: number }>();
  for (const it of m.items) {
    const i = info(it.id);
    if (!i) continue;
    files.add(i.fileOrder);
    const key = `${i.fileOrder}|${i.section ?? ''}`;
    const s = sections.get(key);
    if (s) { s.lo = Math.min(s.lo, i.position); s.hi = Math.max(s.hi, i.position); } else sections.set(key, { lo: i.position, hi: i.position });
  }
  let span = 0;
  for (const s of sections.values()) span += s.hi - s.lo;
  const f = files.size;
  const sec = sections.size;
  if (grouping === 'clumped') return (f - 1) * FILE + (sec - f) * SECTION + span;
  if (grouping === 'spread') return (f - 1) * FILE - sec * SECTION - span;
  return (m.items.length - f) * FILE; // across: fewest numbers from a file already used
}

function keyOf(m: Match, terms: Terms, info: (id: string) => ItemInfo | undefined, grouping: Grouping | undefined): Key {
  let prefers = 0;
  let flips = 0;
  let fileOrder = Infinity;
  let position = Infinity;
  let fileLabel = '';
  for (const it of m.items) {
    if (it.sign === -1) flips++;
    const i = info(it.id);
    if (!i) continue;
    prefers = Math.max(prefers, preferHits(i.text, terms));
    if (i.fileOrder < fileOrder || (i.fileOrder === fileOrder && i.position < position)) {
      fileOrder = i.fileOrder;
      position = i.position;
      fileLabel = i.fileLabel;
    }
  }
  const count = m.items.length;
  return { single: count === 1 ? 0 : 1, count, prefers, group: groupScore(m, grouping, info), flips, diff: Math.abs(m.diff), fileOrder, position, fileLabel };
}

const byPosition = (a: Key, b: Key) => a.fileOrder - b.fileOrder || a.position - b.position;
const byBest = (a: Key, b: Key) =>
  a.single - b.single || b.prefers - a.prefers || a.group - b.group || a.count - b.count || a.flips - b.flips || a.diff - b.diff || byPosition(a, b);

const COMPARE: Record<ResultSort, (a: Key, b: Key) => number> = {
  best: byBest,
  closest: (a, b) => a.diff - b.diff || byBest(a, b),
  file: (a, b) => a.fileLabel.localeCompare(b.fileLabel, undefined, { numeric: true, sensitivity: 'base' }) || byPosition(a, b) || byBest(a, b),
  position: (a, b) => byPosition(a, b) || byBest(a, b),
};

/** A new array of the matches in the given order (stable). `grouping` is the search mode for sums. */
export function sortMatches(
  matches: Match[], sort: ResultSort, terms: Terms, info: (id: string) => ItemInfo | undefined, grouping?: Grouping,
): Match[] {
  const compare = COMPARE[sort];
  return matches
    .map((m, i) => ({ m, i, k: keyOf(m, terms, info, grouping) }))
    .sort((a, b) => compare(a.k, b.k) || a.i - b.i)
    .map(x => x.m);
}
