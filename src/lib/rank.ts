// Orders for search results. The engine reports matches as it finds them (single numbers first, then
// pairs, and so on); these put them in the order the user asked for.
//
//   best      single numbers first; then the ones that mention a 'preferred word; then, for sums, how
//             the numbers sit together (the search mode below); then fewest numbers, fewest negatives,
//             closest to the target, document order
//   closest   smallest difference from the number typed, then as "best"
//   file      by file (as shown), then position in the file
//   position  document order: files in the order they were added, then position in the file
//
// Search mode (sums only) — which groupings of numbers come first:
//   clumped    numbers from one file, on one page or sheet, in the same row where possible
//   spread     numbers from one file, but far apart in it (different pages or sheets, distant rows)
//   across     one number from each file, like a return line built from several source documents
//   scattered  as far apart as the documents allow: different files, pages and rows
//
// "Clumped" and "scattered" are opposites, and both read the same four things: how many files the
// numbers come from, how many pages or sheets, how many rows, and how far apart they sit within a page.

import type { Match } from '../types';
import { preferHits, type Terms } from './query';

export type ResultSort = 'best' | 'closest' | 'file' | 'position';

// "Closest" is about the number typed, not about how close together the numbers are — the search mode
// covers that — so the label says so.
export const SORT_LABEL: Record<ResultSort, string> = {
  best: 'Best match',
  closest: 'Closest to the number typed',
  file: 'By file',
  position: 'Document order',
};

export const SORTS = Object.keys(SORT_LABEL) as ResultSort[];

export const SORT_HINT =
  'Best match: single numbers first, then sums whose numbers sit together the way the search mode asks (same row first when clumped). Closest to the number typed: smallest difference first, whatever it is made of.';

export type Grouping = 'clumped' | 'spread' | 'across' | 'scattered';

export const GROUPINGS: Grouping[] = ['clumped', 'spread', 'across', 'scattered'];
export const GROUPING_LABEL: Record<Grouping, string> = {
  clumped: 'Clumped (same row first)',
  spread: 'Spread (within files)',
  across: 'Across files',
  scattered: 'Most spread',
};
/** For summaries and the pill: "across files". */
export const GROUPING_SHORT: Record<Grouping, string> = {
  clumped: 'clumped', spread: 'spread within files', across: 'across files', scattered: 'most spread',
};
export const GROUPING_HINT =
  'Which sums come first. Clumped: numbers next to each other in one file, in the same row where possible. Spread: one file, numbers far apart. Across files: one number from each file, like a return line built from several source documents. Most spread: as far apart as the documents allow.';

export const DEFAULT_GROUPING: Grouping = 'clumped';
export const groupingOf = (s: { grouping?: Grouping }): Grouping => s.grouping ?? DEFAULT_GROUPING;

/** What the ranking needs to know about one number. */
export interface ItemInfo {
  /** Order the file was added in. */
  fileOrder: number;
  /** Index within the file, in reading order. */
  position: number;
  /** Page or sheet within the file ('' when unknown). */
  section?: string;
  /** The row it sits in: a sheet row, or a line of a page. Undefined when unknown. */
  row?: string;
  /** The file's name as shown. */
  fileLabel: string;
  /** Lower-case label + file name + sheet, as the filters see it. */
  text: string;
}

interface Key { single: number; count: number; prefers: number; group: number; flips: number; diff: number; fileOrder: number; position: number; fileLabel: string }

// Weights keep the parts of a score apart: files outrank pages/sheets, which outrank rows, which outrank
// distance within a page. A same-row sum therefore beats every same-page sum that straddles rows.
const FILE = 1e12;
const SECTION = 1e9;
const ROW = 1e6;
const SPAN_CAP = ROW - 1;

interface Spread { files: number; sections: number; rows: number; span: number }

/** How the numbers of a sum sit together: distinct files, pages/sheets and rows, and the spread within a page. */
function spreadOf(m: Match, info: (id: string) => ItemInfo | undefined): Spread {
  const files = new Set<number>();
  const rows = new Set<string>();
  const sections = new Map<string, { lo: number; hi: number }>();
  for (const it of m.items) {
    const i = info(it.id);
    if (!i) continue;
    files.add(i.fileOrder);
    const key = `${i.fileOrder}|${i.section ?? ''}`;
    rows.add(`${key}|${i.row ?? i.position}`); // no row known: each number counts as its own row
    const s = sections.get(key);
    if (s) { s.lo = Math.min(s.lo, i.position); s.hi = Math.max(s.hi, i.position); } else sections.set(key, { lo: i.position, hi: i.position });
  }
  let span = 0;
  for (const s of sections.values()) span += s.hi - s.lo;
  return { files: files.size, sections: sections.size, rows: rows.size, span: Math.min(span, SPAN_CAP) };
}

/** Lower is better. 0 for single numbers and when no mode applies. */
function groupScore(m: Match, grouping: Grouping | undefined, info: (id: string) => ItemInfo | undefined): number {
  if (!grouping || m.items.length < 2) return 0;
  const { files: f, sections: sec, rows, span } = spreadOf(m, info);
  // Every number in one row is the tightest a sum can be, so rows weigh more than distance within a page.
  if (grouping === 'clumped') return (f - 1) * FILE + (sec - f) * SECTION + (rows - sec) * ROW + span;
  if (grouping === 'spread') return (f - 1) * FILE - (sec - 1) * SECTION - (rows - 1) * ROW - span;
  if (grouping === 'scattered') return -(f - 1) * FILE - (sec - 1) * SECTION - (rows - 1) * ROW - span;
  return (m.items.length - f) * FILE + (rows - sec) * ROW; // across: fewest numbers from a file already used
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
// After single numbers and 'preferred words: how the numbers sit together (the search mode), then size.
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
