// Orders for search results. The engine reports matches as it finds them (single numbers first, then
// pairs, and so on); these put them in the order the user asked for.
//
//   best      fewest numbers, then the ones that mention a 'preferred word, then fewest negatives,
//             then closest to the target, then document order
//   closest   smallest difference from the target first, then as "best"
//   file      by file (as shown), then position in the file
//   position  document order: files in the order they were added, then position in the file

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

/** What the ranking needs to know about one number. */
export interface ItemInfo {
  /** Order the file was added in. */
  fileOrder: number;
  /** Index within the file, in reading order. */
  position: number;
  /** The file's name as shown. */
  fileLabel: string;
  /** Lower-case label + file name + sheet, as the filters see it. */
  text: string;
}

interface Key { count: number; prefers: number; flips: number; diff: number; fileOrder: number; position: number; fileLabel: string }

function keyOf(m: Match, terms: Terms, info: (id: string) => ItemInfo | undefined): Key {
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
  return { count: m.items.length, prefers, flips, diff: Math.abs(m.diff), fileOrder, position, fileLabel };
}

const byPosition = (a: Key, b: Key) => a.fileOrder - b.fileOrder || a.position - b.position;
const byBest = (a: Key, b: Key) => a.count - b.count || b.prefers - a.prefers || a.flips - b.flips || a.diff - b.diff || byPosition(a, b);

const COMPARE: Record<ResultSort, (a: Key, b: Key) => number> = {
  best: byBest,
  closest: (a, b) => a.diff - b.diff || byBest(a, b),
  file: (a, b) => a.fileLabel.localeCompare(b.fileLabel, undefined, { numeric: true, sensitivity: 'base' }) || byPosition(a, b) || byBest(a, b),
  position: (a, b) => byPosition(a, b) || byBest(a, b),
};

/** A new array of the matches in the given order (stable). */
export function sortMatches(matches: Match[], sort: ResultSort, terms: Terms, info: (id: string) => ItemInfo | undefined): Match[] {
  const compare = COMPARE[sort];
  return matches
    .map((m, i) => ({ m, i, k: keyOf(m, terms, info) }))
    .sort((a, b) => compare(a.k, b.k) || a.i - b.i)
    .map(x => x.m);
}
