// Parsing and display helpers for the UI. Pure: no DOM, no state.

import type { Amount, FileKind, FileLimit, ParsedFile, Rounding } from '../types';

/** Parse a typed amount: "3,235", "$3,234.56", "(75.00)" → -75, "75.00-" → -75. Null when not a number. */
export function parseAmountInput(text: string): number | null {
  let t = String(text ?? '').trim().replace(/[\s,$€£]/g, '');
  if (t === '') return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  else if (/^[^-].*-$/.test(t)) { neg = true; t = t.slice(0, -1); }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return neg ? -n : n;
}

/** Decimal places the user typed ("3,234.56" → 2, "3,235" → 0). */
export function decimalsOf(text: string): number {
  const m = /\.(\d+)/.exec(text);
  return m ? m[1].length : 0;
}

/**
 * Per-file limit inside a group.
 *   "" / "any" → no limit        "1" → at most 1        "1-2" → at least 1, at most 2        "2+" → at least 2
 */
export function parseLimit(text: string): FileLimit | null {
  const t = String(text ?? '').trim().toLowerCase();
  if (t === '' || t === 'any') return { min: 0, max: null };
  let m = /^(\d+)$/.exec(t);
  if (m) return { min: 0, max: +m[1] };
  m = /^(\d+)\s*(?:-|–|to)\s*(\d+)$/.exec(t);
  if (m) return +m[1] <= +m[2] ? { min: +m[1], max: +m[2] } : null;
  m = /^(\d+)\s*\+$/.exec(t);
  if (m) return { min: +m[1], max: null };
  return null;
}

export function describeLimit(text: string): string {
  const l = parseLimit(text);
  if (!l) return 'invalid';
  if (l.max === null) return l.min === 0 ? 'any' : `at least ${l.min}`;
  if (l.min === 0) return `max ${l.max}`;
  return l.min === l.max ? `exactly ${l.min}` : `${l.min}–${l.max}`;
}

const money2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** "3,234.56", "3,235", "−265.44" (true minus sign). */
export function formatMoney(n: number, decimals = 2): string {
  const r = Math.round(n * 100) / 100;
  const s = (decimals === 0 && Number.isInteger(r) ? money0 : money2).format(Math.abs(r));
  return r < 0 ? `−${s}` : s;
}

export const ROUNDING_LABEL: Record<Rounding, string> = {
  dollar: 'Whole dollars (±0.50)',
  cent: 'Within 1 cent',
  exact: 'Exact',
};
export const ROUNDING_SHORT: Record<Rounding, string> = { dollar: 'whole dollars', cent: 'within 1 cent', exact: 'exact' };

// How many numbers may add up to the target: 1 (the number itself), a sum of up to N numbers,
// or any sum. Every choice also finds the number itself, and exact matches are listed first.
export const MIN_SUM_SIZE = 2;
export const MAX_SUM_SIZE = 20;
export const MADE_OF_HINT = 'How many numbers may add up to it. Exact matches of the number itself always show first.';

/** Short form for summaries: "1 number", "sums of up to 3", "any sum". */
export function madeOfLabel(n: number | null): string {
  if (n === 1) return '1 number';
  if (n === null) return 'any sum';
  return `sums of up to ${n}`;
}

/** For sentences: "Nothing makes 9,120 as a single number or a sum of up to 3 numbers". */
export function madeOfPhrase(n: number | null): string {
  if (n === 1) return 'as a single number';
  if (n === null) return 'as a single number or any sum';
  return `as a single number or a sum of up to ${n} numbers`;
}

export const KIND_LABEL: Record<FileKind, string> = { pdf: 'PDF', excel: 'Excel', csv: 'CSV' };

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "PDF · 2 pages · 14 numbers" */
export function fileMeta(p: ParsedFile): string {
  const parts = [KIND_LABEL[p.kind]];
  if (p.kind === 'pdf' && p.pageCount) parts.push(plural(p.pageCount, 'page'));
  if (p.kind === 'excel' && p.sheets) parts.push(plural(p.sheets.length, 'sheet'));
  parts.push(plural(p.amounts.length, 'number'));
  return parts.join(' · ');
}

/** "page 2", "Interest!D9", "row 5" (CSV). */
export function locationShort(a: Amount): string {
  const l = a.location;
  if (l.kind === 'pdf') return `page ${l.page}`;
  if (l.sheet === 'CSV') return `row ${l.cell.replace(/^[A-Z]+/, '')}`;
  return `${l.sheet}!${l.cell}`;
}

/** "18.00 less than 9,120" */
export function diffPhrase(diff: number, target: number, targetDecimals: number): string {
  if (Math.abs(diff) < 0.005) return `same as ${formatMoney(target, targetDecimals)}`;
  return `${formatMoney(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'} than ${formatMoney(target, targetDecimals)}`;
}

export function uid(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
