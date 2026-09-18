// Telling apart results that read the same.
//
// A W-2 has 85,000 in box 1 (wages) and again in box 3 (social security wages), so "85,000 + 2,000 +
// 3,235" can be two different real answers — same file, same page, same numbers on screen. A sum's title
// also stops naming files after the first two ("and 2 other files"), so two sums can read the same while
// coming from different files. The engine is right to report both. The list has to say which is which.

import type { Match } from '../types';

/**
 * Which numbers need a word saying which one they are, and what they are being told apart from.
 *
 * `face` returns exactly what a match reads as in the list (its title and its numbers) — anything the
 * list does not show must be left out, or matches that look identical will not be compared. Matches
 * sharing a face are lined up position by position; where the numbers differ, every id at that position
 * is returned with all the ids it shares the spot with, so the caller can say as much as it takes to
 * tell them apart (a label when they are in one file, the file name when they are not).
 */
export function lookalikeItems(matches: Match[], face: (m: Match) => string): Map<string, string[]> {
  const groups = new Map<string, Match[]>();
  for (const m of matches) {
    if (m.items.length < 2) continue; // single numbers already show their file, location and label
    const key = face(m);
    const g = groups.get(key);
    if (g) g.push(m);
    else groups.set(key, [m]);
  }
  const out = new Map<string, string[]>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const n = Math.min(...g.map(m => m.items.length));
    for (let i = 0; i < n; i++) {
      const ids = [...new Set(g.map(m => m.items[i].id))];
      if (ids.length > 1) for (const id of ids) out.set(id, ids);
    }
  }
  return out;
}
