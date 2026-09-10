// The find box takes a number plus optional filter words, like a search engine:
//   3,235              → find what makes 3,235
//   3,235 -hours       → …skipping numbers whose label, sheet, or file name mentions "hours"
//   3,235 interest     → …searching only numbers that mention "interest"
//   -"hourly rate"     → quotes keep a phrase together
// A minus directly before a digit is a negative number ("-265.44"), not a filter. Filters apply before the
// search, so a skipped number can never be part of a sum.

import type { Amount } from '../types';
import { decimalsOf, parseAmountInput } from './format';

export interface Terms {
  include: string[];
  exclude: string[];
}

export const NO_TERMS: Terms = { include: [], exclude: [] };

export interface Query {
  value: number | null;
  decimals: number;
  /** The number as typed, e.g. "3,235". */
  valueText: string;
  terms: Terms;
  /** Numbers after the first one: an error to report, not silently ignored. */
  extraNumbers: string[];
}

const TOKEN = /-?"[^"]*"?|\S+/g;

export function parseQuery(text: string): Query {
  const q: Query = { value: null, decimals: 0, valueText: '', terms: { include: [], exclude: [] }, extraNumbers: [] };
  for (const raw of String(text ?? '').match(TOKEN) ?? []) {
    const minusFilter = /^-(?![\d.(])/.test(raw);
    const plusFilter = raw.startsWith('+') && !/^\+[\d.]/.test(raw);
    const body = minusFilter || plusFilter ? raw.slice(1) : raw;
    if (!minusFilter && /\d/.test(body)) {
      const n = parseAmountInput(body);
      if (n !== null) {
        if (q.value === null) { q.value = n; q.decimals = decimalsOf(body); q.valueText = body; }
        else q.extraNumbers.push(body);
        continue;
      }
    }
    const word = body.replace(/^"|"$/g, '').trim().toLowerCase();
    if (!word) continue;
    const list = minusFilter ? q.terms.exclude : q.terms.include;
    if (!list.includes(word)) list.push(word);
  }
  return q;
}

export const hasTerms = (t: Terms) => t.include.length > 0 || t.exclude.length > 0;

/** Does an amount survive the filters? Matches against its label, its sheet name, and its file name. */
export function passesTerms(a: Amount, fileName: string, t: Terms): boolean {
  if (!hasTerms(t)) return true;
  const hay = `${a.label} ${fileName} ${a.location.kind === 'sheet' ? a.location.sheet : ''}`.toLowerCase();
  return t.exclude.every(w => !hay.includes(w)) && t.include.every(w => hay.includes(w));
}

const quoted = (ts: string[]) => ts.map(t => `“${t}”`).join(', ');

/** Short form for summaries: "skipping “hours” · only “interest”"; '' without filters. */
export function termsPhrase(t: Terms): string {
  return [t.exclude.length ? `skipping ${quoted(t.exclude)}` : '', t.include.length ? `only ${quoted(t.include)}` : '']
    .filter(Boolean)
    .join(' · ');
}

/** Sentence for the line under the find box; '' without filters. */
export function termsSentence(t: Terms): string {
  const parts: string[] = [];
  if (t.include.length) parts.push(`Only numbers that mention ${quoted(t.include)}`);
  if (t.exclude.length) parts.push(`${parts.length ? 'skipping' : 'Skipping'} numbers that mention ${quoted(t.exclude)}`);
  return parts.length ? `${parts.join(', ')}.` : '';
}

/** Filters back to box text, e.g. `interest -hours -"hourly rate"`. */
export function serializeTerms(t: Terms): string {
  const w = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  return [...t.include.map(w), ...t.exclude.map(s => `-${w(s)}`)].join(' ');
}
