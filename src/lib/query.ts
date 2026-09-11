// The search bar's grammar. Everything is typed in one box:
//   3,235                    find what makes 3,235
//   3,235 85,000             two numbers: two searches
//   3,200..3,300             every number in a range
//   3,235 -hours             skip numbers whose label, sheet, or file name mentions "hours"
//   3,235 interest           only numbers that mention "interest" (case-insensitive)
//   3,235 "box 1"            quotes: must mention exactly this phrase; -"hourly rate" skips it
//   3,235 ~intrest           ~word: must mention something close to it (a small typo, 1099int for 1099-INT)
//   3,235 '2025              'text: read as text even if it looks like a number; numbers that mention it
//                            are listed first (a preference, not a filter); -'2025 skips it
//   3,235 in:Source          look in the group whose name starts with "Source" (quotes for spaces)
//   check:"2025 return"      look up every number in that group (against the "in" group)
//   3,235 sums:3             sums of up to 3 numbers (sums:any, sums:1)
//   3,235 ±0.50  or  ~0.50   within 50 cents (~ before a number is a tolerance, before a word a fuzzy match)
//   3,235 neg                let numbers count as negative
// A minus directly before a digit is a negative number ("-265.44"), not a filter. Filters apply before
// the search, so a skipped number can never be part of a sum.

import type { Amount } from '../types';
import { fuzzyIncludes } from './fuzzy';
import { decimalsOf, parseAmountInput } from './format';

export interface Terms {
  /** Must mention each of these. */
  include: string[];
  /** Must mention none of these. */
  exclude: string[];
  /** Must mention something close to each of these (~word). */
  fuzzy: string[];
  /** Numbers that mention these are listed first ('word); not a filter. */
  prefer: string[];
}

export const NO_TERMS: Terms = { include: [], exclude: [], fuzzy: [], prefer: [] };
export const emptyTerms = (): Terms => ({ include: [], exclude: [], fuzzy: [], prefer: [] });

/** Terms saved by an earlier version may lack the newer lists. */
export const normalizeTerms = (t: Partial<Terms> | undefined): Terms => ({ ...emptyTerms(), ...t });

export interface QueryNumber { value: number; decimals: number; text: string }

export interface Query {
  numbers: QueryNumber[];
  range: { lo: number; hi: number; text: string } | null;
  terms: Terms;
  /** Group named with in:, as typed. */
  inGroup: string | null;
  /** Group named with check:, as typed: look up every number in it. */
  checkGroup: string | null;
  /** undefined = not given; null = any sum. */
  maxCount: number | null | undefined;
  tolerance: number | undefined;
  negatives: boolean | undefined;
  errors: string[];
}

const TOKEN = /[^\s"]*"[^"]*"?|\S+/g;

export function parseQuery(text: string): Query {
  const q: Query = { numbers: [], range: null, terms: emptyTerms(), inGroup: null, checkGroup: null, maxCount: undefined, tolerance: undefined, negatives: undefined, errors: [] };
  const unquote = (s: string) => s.replace(/^"|"$/g, '').trim();
  const add = (list: string[], word: string) => { if (word && !list.includes(word)) list.push(word); };
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

    m = /^(?:check|every|all):(.+)$/i.exec(raw);
    if (m) { q.checkGroup = unquote(m[1]); continue; }

    m = /^sums?:(.+)$/i.exec(raw);
    if (m) {
      const v = m[1].toLowerCase();
      if (v === 'any') q.maxCount = null;
      else if (/^\d+$/.test(v) && +v >= 1) q.maxCount = +v;
      else q.errors.push(`"${raw}" should be sums:3 or sums:any.`);
      continue;
    }

    // ±0.50, tol:0.50, or ~0.50: a tolerance. ~ before anything that isn't a number is a fuzzy word (below).
    m = /^(?:±|tol:)(.+)$/i.exec(raw);
    if (m) {
      const t = parseAmountInput(m[1]);
      if (t === null || t < 0) q.errors.push(`"${raw}" should be like ±0.50.`);
      else q.tolerance = t;
      continue;
    }
    if (raw.startsWith('~')) {
      const t = parseAmountInput(raw.slice(1));
      if (t !== null) {
        if (t < 0) q.errors.push(`"${raw}" should be like ~0.50.`);
        else q.tolerance = t;
        continue;
      }
    }

    if (lower === 'neg' || lower === 'negatives' || lower === 'negatives:on') { q.negatives = true; continue; }
    if (lower === 'negatives:off') { q.negatives = false; continue; }

    // Prefixes: - (skip), + (keep), ~ (close to), ' (text, preferred). -' skips the text; -~ skips anything close.
    const minusFilter = /^-(?![\d.(])/.test(raw);
    const plusFilter = raw.startsWith('+') && !/^\+[\d.]/.test(raw);
    let body = minusFilter || plusFilter ? raw.slice(1) : raw;
    const fuzzy = body.startsWith('~');
    const asText = body.startsWith("'") || body.startsWith('’');
    if (fuzzy || asText) body = body.slice(1);
    if (!minusFilter && !fuzzy && !asText && /\d/.test(body)) {
      const n = parseAmountInput(body);
      if (n !== null) { q.numbers.push({ value: n, decimals: decimalsOf(body), text: body }); continue; }
    }
    const word = unquote(body).toLowerCase();
    if (!word) continue;
    if (minusFilter) add(q.terms.exclude, word);
    else if (fuzzy) add(q.terms.fuzzy, word);
    else if (asText) add(q.terms.prefer, word);
    else add(q.terms.include, word);
  }
  return q;
}

/** Does any of the lists filter numbers out? (Preferences don't.) */
export const hasTerms = (t: Terms) => t.include.length > 0 || t.exclude.length > 0 || t.fuzzy.length > 0;
export const hasAnyTerms = (t: Terms) => hasTerms(t) || t.prefer.length > 0;

/** The text a number is matched against: its label, the file's name and short name, and its sheet name. */
export function termText(a: Amount, fileText: string): string {
  return `${a.label} ${fileText} ${a.location.kind === 'sheet' ? a.location.sheet : ''}`.toLowerCase();
}

/** Does an amount survive the filters? Matches against its label, its sheet name, and the given file text. */
export function passesTerms(a: Amount, fileText: string, t: Terms): boolean {
  if (!hasTerms(t)) return true;
  const hay = termText(a, fileText);
  return t.exclude.every(w => !hay.includes(w)) && t.include.every(w => hay.includes(w)) && t.fuzzy.every(w => fuzzyIncludes(hay, w));
}

/** How many of the preferred words the text mentions. */
export function preferHits(hay: string, t: Terms): number {
  let n = 0;
  for (const w of t.prefer) if (hay.includes(w)) n++;
  return n;
}

const quoted = (ts: string[]) => ts.map(t => `“${t}”`).join(', ');

/** Short form for summaries: "skipping “hours” · only “interest” · about “intrest” · “2025” first"; '' without terms. */
export function termsPhrase(t: Terms): string {
  return [
    t.exclude.length ? `skipping ${quoted(t.exclude)}` : '',
    t.include.length ? `only ${quoted(t.include)}` : '',
    t.fuzzy.length ? `close to ${quoted(t.fuzzy)}` : '',
    t.prefer.length ? `${quoted(t.prefer)} first` : '',
  ].filter(Boolean).join(' · ');
}

/** Sentence for the line under the search bar; '' without terms. */
export function termsSentence(t: Terms): string {
  const mention = [t.include.length ? quoted(t.include) : '', t.fuzzy.length ? `something close to ${quoted(t.fuzzy)}` : ''].filter(Boolean).join(' and ');
  const parts: string[] = [];
  if (mention) parts.push(`Only numbers that mention ${mention}`);
  if (t.exclude.length) parts.push(`${parts.length ? 'skipping' : 'Skipping'} numbers that mention ${quoted(t.exclude)}`);
  const s = parts.length ? `${parts.join(', ')}.` : '';
  if (!t.prefer.length) return s;
  return `${s}${s ? ' ' : ''}Numbers that mention ${quoted(t.prefer)} are listed first.`;
}

/** Terms back to bar text, e.g. `interest ~intrest '2025 -hours -"hourly rate"`. */
export function serializeTerms(t: Terms): string {
  const w = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  return [
    ...t.include.map(w),
    ...t.fuzzy.map(s => `~${w(s)}`),
    ...t.prefer.map(s => `'${w(s)}`),
    ...t.exclude.map(s => `-${w(s)}`),
  ].join(' ');
}

/** `check:"2025 return"`: the group name as it goes in the bar. */
export function checkToken(groupName: string): string {
  return `check:${/\s/.test(groupName) ? `"${groupName}"` : groupName}`;
}

/**
 * "+-" and "-+" typed in the bar become "±". Returns the new text and where the caret goes,
 * or null when there's nothing to replace.
 */
export function foldPlusMinus(text: string, caret: number): { text: string; caret: number } | null {
  if (!/\+-|-\+/.test(text)) return null;
  let out = '';
  let pos = caret;
  let i = 0;
  while (i < text.length) {
    if ((text[i] === '+' && text[i + 1] === '-') || (text[i] === '-' && text[i + 1] === '+')) {
      out += '±';
      if (i + 2 <= caret) pos--; // the pair sat before the caret: one character fewer
      i += 2;
    } else {
      out += text[i++];
    }
  }
  return { text: out, caret: Math.max(0, Math.min(pos, out.length)) };
}
