// Parsing and display helpers for the UI. Pure: no DOM, no state.

import type { Amount, FileKind, ParsedFile, Rounding } from '../types';

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

/** "whole dollars", or "±0.25" when a tolerance was typed in the bar. */
export function roundingPhrase(rounding: Rounding, tolerance?: number): string {
  return tolerance === undefined ? ROUNDING_SHORT[rounding] : tolerance === 0 ? 'exact' : `±${formatMoney(tolerance)}`;
}

// How many numbers may add up to the target: 1 (the number itself), a sum of up to N numbers,
// or any sum. Every choice also finds the number itself, and exact matches are listed first.
export const MIN_SUM_SIZE = 2;
export const MAX_SUM_SIZE = 20;
export const MADE_OF_HINT = 'How many numbers may add up to it. Exact matches of the number itself always show first.';

/** Short form for summaries: "1 number", "sums of up to 3", "sums of exactly 3", "sums of 2 to 4", "sums of 2 or more", "any sum". */
export function madeOfLabel(max: number | null, min = 1): string {
  if (max === 1) return '1 number';
  if (max === null) return min > 1 ? `sums of ${min} or more` : 'any sum';
  if (min === max) return `sums of exactly ${max}`;
  if (min > 1) return `sums of ${min} to ${max}`;
  return `sums of up to ${max}`;
}

/** For sentences: "Nothing makes 9,120 as a single number or a sum of up to 3 numbers". */
export function madeOfPhrase(max: number | null, min = 1): string {
  if (max === 1) return 'as a single number';
  if (max === null) return min > 1 ? `as a sum of ${min} or more numbers` : 'as a single number or any sum';
  if (min === max) return `as a sum of exactly ${max} numbers`;
  if (min > 1) return `as a sum of ${min} to ${max} numbers`;
  return `as a single number or a sum of up to ${max} numbers`;
}

// How long a sum search may run. Single numbers finish at once, so these only matter for sums.
// null = no limit: the search runs until it has tried everything or is stopped.
export const SEARCH_SECONDS: (number | null)[] = [10, 30, 120, 600, null];
export const DEFAULT_SEARCH_SECONDS = 30;
/** A check searches each of its numbers in turn; this is the time each one gets. */
export const CHECK_SECONDS = [2, 10, 30, 120];
export const DEFAULT_CHECK_SECONDS = 2;

/** "45 s", "2 min", "1 min 30 s", "1 h", "no limit". */
export function secondsLabel(s: number | null): string {
  if (s === null) return 'no limit';
  if (s < 60) return `${s} s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
  return `${+(s / 3600).toFixed(1)} h`;
}

/** The next longer choice after `s` (null = no limit is the longest), or undefined when there is none. */
export function longerSeconds(s: number | null, choices: (number | null)[] = SEARCH_SECONDS): number | null | undefined {
  if (s === null) return undefined;
  return choices.find(c => c === null || c > s);
}

/** Elapsed time for progress lines: "0.4 s", "8.4 s", "42 s", "1 min 05 s". */
export function elapsedLabel(ms: number): string {
  if (ms < 10_000) return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

/** "negatives", "up to 1 negative", or '' when numbers may not count as negative. */
export function negativesLabel(allow: boolean, maxFlips?: number): string {
  if (!allow) return '';
  return maxFlips === undefined ? 'negatives' : `up to ${plural(maxFlips, 'negative')}`;
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

/** For headings: "Page 2 of 3", "Sheet Interest · cell D9", "Row 5" (CSV). */
export function locationLong(a: Amount, pageCount?: number): string {
  const l = a.location;
  if (l.kind === 'pdf') return pageCount && pageCount > 1 ? `Page ${l.page} of ${pageCount}` : `Page ${l.page}`;
  if (l.sheet === 'CSV') return `Row ${l.cell.replace(/^[A-Z]+/, '')}`;
  return `Sheet ${l.sheet} · cell ${l.cell}`;
}

/** "18.00 less than 9,120" */
export function diffPhrase(diff: number, target: number, targetDecimals: number): string {
  if (Math.abs(diff) < 0.005) return `same as ${formatMoney(target, targetDecimals)}`;
  return `${formatMoney(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'} than ${formatMoney(target, targetDecimals)}`;
}

export function uid(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
