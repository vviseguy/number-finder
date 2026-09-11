// The search bar's grammar. Everything is typed in one box:
//   3,235                    find what makes 3,235
//   3,235 85,000             two numbers: two searches
//   3,200..3,300             every number in a range
//   3,235 -hours             skip numbers whose label, sheet, or file name mentions "hours"
//   3,235 interest           only numbers that mention "interest"; quotes keep a phrase: -"hourly rate"
//   3,235 in:Source          look in the group whose name starts with "Source" (quotes for spaces)
//   3,235 sums:3             sums of up to 3 numbers (sums:any, sums:1)
//   3,235 ±0.50  or  ~0.50   within 50 cents
//   3,235 neg                let numbers count as negative
// A minus directly before a digit is a negative number ("-265.44"), not a filter. Filters apply before
// the search, so a skipped number can never be part of a sum.

import type { Amount } from '../types';
import { decimalsOf, parseAmountInput } from './format';

export interface Terms {
  include: string[];
  exclude: string[];
}

export const NO_TERMS: Terms = { include: [], exclude: [] };

export interface QueryNumber { value: number; decimals: number; text: string }

export interface Query {
  numbers: QueryNumber[];
  range: { lo: number; hi: number; text: string } | null;
  terms: Terms;
  /** Group named with in:, as typed. */
  inGroup: string | null;
  /** undefined = not given; null = any sum. */
  maxCount: number | null | undefined;
  tolerance: number | undefined;
  negatives: boolean | undefined;
  errors: string[];
}

const TOKEN = /[^\s"]*"[^"]*"?|\S+/g;

export function parseQuery(text: string): Query {
  const q: Query = { numbers: [], range: null, terms: { include: [], exclude: [] }, inGroup: null, maxCount: undefined, tolerance: undefined, negatives: undefined, errors: [] };
  const unquote = (s: string) => s.replace(/^"|"$/g, '').trim();
  for (const raw of String(text ?? '').match(TOKEN) ?? []) {
    const lower = raw.toLowerCase();

    let m = /^([^.\s]+)\.\.([^.\s]+)$/.exec(raw);
    if (m) {
      const lo = parseAmountInput(m[1]);
      const hi = parseAmountInput(m[2]);
      if (lo === null || hi === null) { q.errors.push(`"${raw}" isn't a range. Try 3,200..3,300.`); continue; }
      q.range = { lo: Math.min(lo, hi), hi: Math.max(lo, hi), text: raw };
      continue;
    }

    m = /^in:(.+)$/i.exec(raw);
    if (m) { q.inGroup = unquote(m[1]); continue; }

    m = /^sums?:(.+)$/i.exec(raw);
    if (m) {
      const v = m[1].toLowerCase();
      if (v === 'any') q.maxCount = null;
      else if (/^\d+$/.test(v) && +v >= 1) q.maxCount = +v;
      else q.errors.push(`"${raw}" should be sums:3 or sums:any.`);
      continue;
    }

    m = /^(?:±|~|tol:)(.+)$/i.exec(raw);
    if (m) {
      const t = parseAmountInput(m[1]);
      if (t === null || t < 0) q.errors.push(`"${raw}" should be like ±0.50.`);
      else q.tolerance = t;
      continue;
    }

    if (lower === 'neg' || lower === 'negatives' || lower === 'negatives:on') { q.negatives = true; continue; }
    if (lower === 'negatives:off') { q.negatives = false; continue; }

    const minusFilter = /^-(?![\d.(])/.test(raw);
    const plusFilter = raw.startsWith('+') && !/^\+[\d.]/.test(raw);
    const body = minusFilter || plusFilter ? raw.slice(1) : raw;
    if (!minusFilter && /\d/.test(body)) {
      const n = parseAmountInput(body);
      if (n !== null) { q.numbers.push({ value: n, decimals: decimalsOf(body), text: body }); continue; }
    }
    const word = unquote(body).toLowerCase();
    if (!word) continue;
    const list = minusFilter ? q.terms.exclude : q.terms.include;
    if (!list.includes(word)) list.push(word);
  }
  return q;
}

export const hasTerms = (t: Terms) => t.include.length > 0 || t.exclude.length > 0;

/** Does an amount survive the filters? Matches against its label, its sheet name, and the given file text. */
export function passesTerms(a: Amount, fileText: string, t: Terms): boolean {
  if (!hasTerms(t)) return true;
  const hay = `${a.label} ${fileText} ${a.location.kind === 'sheet' ? a.location.sheet : ''}`.toLowerCase();
  return t.exclude.every(w => !hay.includes(w)) && t.include.every(w => hay.includes(w));
}

const quoted = (ts: string[]) => ts.map(t => `“${t}”`).join(', ');

/** Short form for summaries: "skipping “hours” · only “interest”"; '' without filters. */
export function termsPhrase(t: Terms): string {
  return [t.exclude.length ? `skipping ${quoted(t.exclude)}` : '', t.include.length ? `only ${quoted(t.include)}` : '']
    .filter(Boolean)
    .join(' · ');
}

/** Sentence for the line under the search bar; '' without filters. */
export function termsSentence(t: Terms): string {
  const parts: string[] = [];
  if (t.include.length) parts.push(`Only numbers that mention ${quoted(t.include)}`);
  if (t.exclude.length) parts.push(`${parts.length ? 'skipping' : 'Skipping'} numbers that mention ${quoted(t.exclude)}`);
  return parts.length ? `${parts.join(', ')}.` : '';
}

/** Filters back to bar text, e.g. `interest -hours -"hourly rate"`. */
export function serializeTerms(t: Terms): string {
  const w = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  return [...t.include.map(w), ...t.exclude.map(s => `-${w(s)}`)].join(' ');
}
