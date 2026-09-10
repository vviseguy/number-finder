/** Label text helpers shared by PDF and spreadsheet extraction. Pure functions. */

export const MAX_LABEL = 70;

const BOX_NUMBER = /^(?:(?:line|box)\s*)?\(?\d{1,2}[a-z]?\)?[.:]?$/i;
const LEADING_BOX = /^(?:(?:line|box)\s+)?\(?\d{1,2}[a-z]?\)?[.:]?\s/i;
// Three or more leader dots (". . . ." or "....."), optionally followed by the line number printed next to the value.
const TRAILING_LEADERS = /(?:\s*[.·_…]){3,}\s*(\(?\d{1,2}[a-z]?\)?)?\s*$/i;
const LEADERS = /(?:\s*[.·_…]){3,}/g;

/** "1", "25a", "(3)", "Line 9", "Box 12" — a bare box or line number. */
export function isBoxNumber(s: string): boolean {
  return BOX_NUMBER.test(s.trim());
}

/** "1 Interest income", "25a Federal…", "Line 9 Total" — text that already starts with its number. */
export function startsWithBoxNumber(s: string): boolean {
  return LEADING_BOX.test(s);
}

export function hasLetter(s: string): boolean {
  return /\p{L}/u.test(s);
}

/** "b Taxable interest . . . . 2b" → { text: "b Taxable interest", box: "2b", leaders: true }. */
export function splitLeaders(s: string): { text: string; box: string; leaders: boolean } {
  const m = TRAILING_LEADERS.exec(s);
  if (!m) return { text: s, box: '', leaders: false };
  return { text: s.slice(0, m.index), box: m[1] ?? '', leaders: true };
}

/** Collapse whitespace, drop leader dots and dangling ":" / "$". Does not cap. */
export function cleanLabel(raw: string): string {
  return raw
    .replace(LEADERS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:$]+|[\s:$]+$/g, '')
    .trim();
}

/** Cap at `max` characters on a word boundary, marking the cut with "…". */
export function capLabel(s: string, max = MAX_LABEL): string {
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(' ', max);
  const head = cut >= max * 0.5 ? s.slice(0, cut) : s.slice(0, max);
  return `${head.replace(/[\s,;:.\-·]+$/, '')}…`;
}

/**
 * Put the box/line number printed next to a value in front of its label, unless the label already has one.
 * "b Taxable interest" + "2b" → "2b Taxable interest"; "Wages" + "1a" → "1a Wages"; "" + "7" → "7".
 */
export function withBoxNumber(label: string, box: string): string {
  const b = box.replace(/^(?:line|box)\s*/i, '').replace(/[().:]/g, '');
  if (!b) return label;
  if (!label) return b;
  if (startsWithBoxNumber(label)) return label;
  const letter = /^([a-z])\s/i.exec(label);
  if (letter && b.toLowerCase().endsWith(letter[1].toLowerCase())) return b + label.slice(1);
  return `${b} ${label}`;
}

/** Spreadsheet label: "RowLabel · Header" when both exist and differ, else whichever exists. Capped. */
export function joinLabels(row: string, header: string): string {
  if (row && header && row.toLowerCase() !== header.toLowerCase()) return capLabel(`${row} · ${header}`);
  return capLabel(row || header);
}
