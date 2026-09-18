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
//   3,235 in:1099            look only in files named like that: in:1099 is both 1099s (repeatable; quotes for spaces)
//   check:1040               look up every number in files named like that, against the other files (repeatable)
//   3,235 sums:3             sums of up to 3 numbers; sums:=3 exactly 3; sums:2..4 between; sums:2+ at least 2; sums:any
//   3,235 ±0.50  or  ~0.50   within 50 cents (~ before a number is a tolerance, before a word a fuzzy match)
//   3,235 neg                let numbers count as negative; neg:1 at most one of them; neg:0 none
//   3,235 mode:clumped       search mode for sums: mode:clumped, mode:spread, mode:across (see lib/rank.ts)
//   3,235 time:2m            how long a sum search may run: time:45s, time:2m, time:1h, time:none
// A minus directly before a digit is a negative number ("-265.44"), not a filter. Filters apply before
// the search, so a skipped number can never be part of a sum.

import type { Amount } from '../types';
import type { Grouping } from './rank';
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

export interface QueryNumber { value: number; decimals: number; text: string }

export interface Query {
  numbers: QueryNumber[];
  range: { lo: number; hi: number; text: string } | null;
  terms: Terms;
  /** Files named with in: (repeatable), as typed. */
  inFiles: string[];
  /** Files named with check: (repeatable), as typed: look up every number in them. */
  checkFiles: string[];
  /** undefined = not given; null = any sum. */
  maxCount: number | null | undefined;
  /** Fewest numbers in a sum (sums:=3, sums:2..4, sums:2+); undefined when not given or 1. */
  minCount: number | undefined;
  tolerance: number | undefined;
  negatives: boolean | undefined;
  /** With negatives: at most this many numbers counted as negative (neg:1); undefined = no limit. */
  maxFlips: number | undefined;
  /** Search mode for sums (mode:clumped); undefined when not given. */
  grouping: Grouping | undefined;
  /** Time limit in seconds (time:2m); null = no limit (time:none); undefined when not given. */
  seconds: number | null | undefined;
  errors: string[];
}

const TOKEN = /[^\s"]*"[^"]*"?|\S+/g;

export function parseQuery(text: string): Query {
  const q: Query = {
    numbers: [], range: null, terms: emptyTerms(), inFiles: [], checkFiles: [],
    maxCount: undefined, minCount: undefined, tolerance: undefined, negatives: undefined, maxFlips: undefined, grouping: undefined, seconds: undefined, errors: [],
  };
  const unquote = (s: string) => s.replace(/^"|"$/g, '').trim();
  const add = (list: string[], word: string) => { if (word && !list.includes(word)) list.push(word); };
  for (const raw of String(text ?? '').match(TOKEN) ?? []) {
    const lower = raw.toLowerCase();

    let m = /^([^.\s:]+)\.\.([^.\s:]+)$/.exec(raw); // a range of amounts (sums:2..4 is a range of counts, below)
    if (m) {
      const lo = parseAmountInput(m[1]);
      const hi = parseAmountInput(m[2]);
      if (lo === null || hi === null) { q.errors.push(`"${raw}" isn't a range. Try 3,200..3,300.`); continue; }
      q.range = { lo: Math.min(lo, hi), hi: Math.max(lo, hi), text: raw };
      continue;
    }

    m = /^in:(.+)$/i.exec(raw);
    if (m) { add(q.inFiles, unquote(m[1])); continue; }

    m = /^(?:check|every|all):(.+)$/i.exec(raw);
    if (m) { add(q.checkFiles, unquote(m[1])); continue; }

    m = /^sums?:(.+)$/i.exec(raw);
    if (m) {
      const v = m[1].toLowerCase();
      let r: RegExpExecArray | null;
      if (v === 'any') { q.maxCount = null; q.minCount = undefined; }
      else if (/^\d+$/.test(v) && +v >= 1) { q.maxCount = +v; q.minCount = undefined; }
      else if ((r = /^=(\d+)$/.exec(v)) && +r[1] >= 1) { q.maxCount = +r[1]; q.minCount = +r[1] > 1 ? +r[1] : undefined; }
      else if ((r = /^(\d+)\.\.(\d+)$/.exec(v)) && +r[1] >= 1 && +r[2] >= +r[1]) { q.minCount = +r[1] > 1 ? +r[1] : undefined; q.maxCount = +r[2]; }
      else if ((r = /^(\d+)\+$/.exec(v)) && +r[1] >= 1) { q.minCount = +r[1] > 1 ? +r[1] : undefined; q.maxCount = null; }
      else q.errors.push(`"${raw}" should be sums:3, sums:=3 (exactly), sums:2..4, sums:2+, or sums:any.`);
      continue;
    }

    m = /^(?:time|limit):(.+)$/i.exec(raw);
    if (m) {
      const v = m[1].toLowerCase();
      const t = /^(\d+(?:\.\d+)?)(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)?$/.exec(v);
      if (v === 'none' || v === 'off' || v === 'no' || v === 'any') q.seconds = null;
      else if (t && +t[1] > 0) q.seconds = Math.max(1, Math.round(+t[1] * (t[2]?.startsWith('h') ? 3600 : t[2]?.startsWith('m') ? 60 : 1)));
      else q.errors.push(`"${raw}" should be like time:30s, time:2m, or time:none.`);
      continue;
    }

    m = /^mode:(.+)$/i.exec(raw);
    if (m) {
      const v = m[1].toLowerCase().replace(/[^a-z]/g, '');
      const g: Grouping | null = v.startsWith('clump') ? 'clumped'
        : v.startsWith('scatter') || v.startsWith('most') || v.startsWith('widest') ? 'scattered'
          : v.startsWith('spread') ? 'spread'
            : v.startsWith('across') || v === 'files' ? 'across' : null;
      if (g) q.grouping = g;
      else q.errors.push(`"${raw}" should be mode:clumped, mode:spread, mode:across, or mode:scattered.`);
      continue;
    }

    m = /^neg(?:atives?)?:(.+)$/i.exec(raw);
    if (m) {
      const v = m[1].toLowerCase();
      if (v === 'off' || v === '0') { q.negatives = false; q.maxFlips = undefined; }
      else if (v === 'on' || v === 'any') { q.negatives = true; q.maxFlips = undefined; }
      else if (/^\d+$/.test(v)) { q.negatives = true; q.maxFlips = +v; }
      else q.errors.push(`"${raw}" should be neg, neg:1 (at most one), or neg:off.`);
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

    if (lower === 'neg' || lower === 'negative' || lower === 'negatives') { q.negatives = true; q.maxFlips = undefined; continue; }

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

/**
 * The bar text without the tokens `drop` picks out, e.g. taking `sums:any` away when a button sets the
 * number of numbers (a typed word would otherwise keep overriding the button).
 */
export function dropTokens(text: string, drop: (raw: string) => boolean): string {
  return (String(text ?? '').match(TOKEN) ?? []).filter(t => !drop(t)).join(' ');
}

/** `check:"1040 draft.pdf"`: a file name as it goes in the bar. */
export function checkToken(fileName: string): string {
  return `check:${/\s/.test(fileName) ? `"${fileName}"` : fileName}`;
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
