/**
 * What counts as an amount — pure functions, no PDF or spreadsheet knowledge.
 *
 * AN AMOUNT IS a money-like token:
 *     [ "(" ] [ "-" ] [ "$" ] digits [ "." 1–4 digits ] [ ")" ] [ trailing "-" ]
 *   - digits are plain ("410") or grouped with commas in threes ("85,000"); bad grouping ("1,2,3") is not an amount
 *   - "$" may be separated from the digits by spaces/tabs (PDFs often draw "$" as its own text item)
 *   - "(265.44)" and "1,234.56-" and "-265.44" are negative; "(0.00)" is 0, never -0
 *   - `text` is the token with inner whitespace removed ("$ 3,234.56" → "$3,234.56"); `decimals` is as written
 *
 * NOT AN AMOUNT (loose text — PDF lines):
 *   - glued to letters or other numbers: "2a", "25a", "W-2", "1099-INT", "W2", "10134D", "Form1099"
 *   - hyphenated/dotted/slashed number groups: SSN 000-00-0000, EIN 12-3456789, OMB 1545-0074, ZIP+4 12345-6789,
 *     phone 555-123-4567 / 555.123.4567 / (555) 123-4567, dates 1/31/2026 and 2025-12-31, ranges 2023-2025
 *   - month-name dates: "Jan 31, 2026", "31 Jan 2026"
 *   - percentages: "22%", "22 %"
 *   - digit runs of 9+ digits without commas or decimals (account numbers), even with "$"
 *   - "plain" integers (no "$", no commas, no decimals) when they are:
 *       1–2 digits (box/line numbers: "1", "25", "(1)");
 *       a year 1900–2099 ("2025", "(2025)");
 *       directly after Form/Schedule/Line/Box/No./#/Page/Copy/OMB/Part/Sec./Suite/Apt… ("Form 1040", "PO Box 500");
 *       a 5-digit ZIP after a US state code ("Anytown, IL 12345");
 *       a street number ("200 Oak Avenue")
 *   "$25", "25.00", "$2,025" and "3,235" are amounts: a "$", a comma, or decimals mark money.
 *
 * SPREADSHEET CELLS (`parseCellAmount`): the whole trimmed cell must be exactly one amount. The token grammar and the
 * pattern rules above (dates, SSN, phone, %, 9+ digit runs) apply; the loose-text context rules (1–2 digits, years,
 * "Form 1040", ZIP, street numbers) do not, because a cell holds one deliberate value ("Schwab | 2000" is money).
 */

export interface AmountToken {
  /** Index of the token's first character in the scanned text (includes "$", "(", "-"). */
  start: number;
  /** Index just past the token (includes ")" or a trailing "-"). */
  end: number;
  /** Token as written, inner whitespace removed: "$3,234.56", "(265.44)". */
  text: string;
  value: number;
  /** Decimal places as written: 2 for "0.00", 0 for "3,235". */
  decimals: number;
}

export interface FindOptions {
  /** The text is one spreadsheet cell: skip the loose-text context rules (see header). */
  cell?: boolean;
}

// Digits, optional comma groups, optional decimals. Validated further in judge().
const CORE = /\d(?:[\d,]*\d)?(?:\.\d+)?/g;

// Characters allowed immediately outside a token (allowlist). Anything else — letters, "*", "#", "/", "@" — rejects it.
const LEFT_OK = /[\s([{:;=|"'“‘<>…]/;
const RIGHT_OK = /[\s)\]}.,;:|"'”’<>*…]/;

const DASHES = /[-‐-―−]/;
const LETTER = /[\p{L}_]/u;
const DIGIT = /\d/;
const ALNUM = /[\p{L}\d]/u;

const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';

/** Spans that are never amounts even though they contain digit groups. */
const EXCLUDED_SPANS: RegExp[] = [
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'gi'), // Jan 31, 2026
  new RegExp(`\\b\\d{1,2}\\s+${MONTH},?\\s+\\d{4}\\b`, 'gi'), // 31 Jan 2026
  /(?:\+?1[\s.-]?)?\(\d{3}\)[\s.-]?\d{3}[\s.-]\d{4}\b/g, // (555) 123-4567
  /(?<![\d,.$])\b\d{3}[ .]\d{3}[ .-]\d{4}\b/g, // 555 123 4567, 555.123.4567
];

/** Words that make the following plain integer an identifier, not money ("Form 1040", "PO Box 500", "Sec. 1250"). */
const KEYWORD_BEFORE =
  /(?:#|\b(?:forms?(?:\(s\))?|schedules?|sch|lines?|box(?:es)?|no|nos|number|page|pages|pg|copy|omb|part|step|item|cat|rev|sec|section|suite|ste|apt|unit|room|rm|floor|fl|§)\.?)\s*$/i;

const STATES =
  'AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|AS|GU|MP|PR|VI|AA|AE|AP';
const ZIP_BEFORE = new RegExp(`(?:^|[\\s,])(?:${STATES})\\.?,?\\s+$`);

const STREET_AFTER =
  /^\s+(?:[NSEW]\.?\s+)?(?:[A-Z0-9][\w'.-]*\s+){0,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Ter|Terrace|Trl|Trail|Sq|Square)\b/;

// Left of the digits, in any usual order: "(", "-", "$", "$ ", "($", "$(", "-$", "$-".
const PREFIX = /(\(\s?)?([-−]\s?)?(\$\s*)?(\(\s?)?([-−])?$/;

/** Find every amount in a run of text, in order. */
export function findAmounts(text: string, options: FindOptions = {}): AmountToken[] {
  const cell = options.cell === true;
  const blocked = excludedSpans(text);
  const out: AmountToken[] = [];
  for (const m of text.matchAll(CORE)) {
    const s = m.index;
    const e = s + m[0].length;
    if (blocked.some(([bs, be]) => s < be && e > bs)) continue;
    const token = judge(text, s, e, m[0], cell);
    if (token) out.push(token);
  }
  return out;
}

/** A spreadsheet/CSV cell that is exactly one amount ("$1,234.56", "(75.00)", "125"), else null. */
export function parseCellAmount(raw: string): AmountToken | null {
  const s = raw.trim();
  if (!s) return null;
  const tokens = findAmounts(s, { cell: true });
  if (tokens.length !== 1) return null;
  const [t] = tokens;
  return t.start === 0 && t.end === s.length ? t : null;
}

/** Decimal places shown in a formatted number: "3,500.00" → 2, "2000" → 0. */
export function decimalsOf(formatted: string): number {
  const m = /\d\.(\d+)/.exec(formatted);
  return m ? m[1].length : 0;
}

function excludedSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const re of EXCLUDED_SPANS) {
    for (const m of text.matchAll(re)) spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

function judge(text: string, s: number, e: number, core: string, cell: boolean): AmountToken | null {
  const dot = core.indexOf('.');
  const intPart = dot < 0 ? core : core.slice(0, dot);
  const decPart = dot < 0 ? '' : core.slice(dot + 1);
  if (decPart.length > 4) return null;
  const hasCommas = intPart.includes(',');
  if (hasCommas && !/^\d{1,3}(?:,\d{3})+$/.test(intPart)) return null;

  const before = text[s - 1] ?? '';
  const before2 = text[s - 2] ?? '';
  const after = text[e] ?? '';
  const after2 = text[e + 1] ?? '';
  const leaderDots = before === '.' && before2 === '.';

  // Glued to letters, or part of a larger dotted/slashed/hyphenated group.
  if (LETTER.test(before) || LETTER.test(after)) return null;
  if ((before === '.' && !leaderDots) || before === ',' || before === '/' || after === '/') return null;
  if ((after === '.' || after === ',') && DIGIT.test(after2)) return null;
  if (DASHES.test(after) && ALNUM.test(after2)) return null;
  if (DASHES.test(before) && ALNUM.test(before2)) return null;
  if (/^\s*%/.test(text.slice(e, e + 4))) return null;

  // Currency and sign to the left.
  const pm = PREFIX.exec(text.slice(Math.max(0, s - 24), s));
  let start = s - (pm ? pm[0].length : 0);
  const outerParen = !!pm?.[1];
  const innerParen = !!pm?.[4];
  const hasDollar = !!pm?.[3];
  const leadMinus = !!(pm?.[2] || pm?.[5]);

  // Closing parenthesis or trailing minus to the right.
  let end = e;
  let paren = false;
  let trailMinus = false;
  const close = /^\s?\)/.exec(text.slice(e, e + 3));
  if ((outerParen || innerParen) && close) {
    paren = true;
    end = e + close[0].length;
  } else if (outerParen || innerParen) {
    if (innerParen) return null; // "$(1,234" with no ")" — malformed
    start += pm![1].length; // "(see 1,234" — the "(" is just punctuation
  } else if (!leadMinus && /^[-−](?!\s*[\d$(])/.test(text.slice(e, e + 8))) {
    trailMinus = true;
    end = e + 1;
  }

  const lb = text[start - 1];
  if (lb !== undefined && !LEFT_OK.test(lb) && !(lb === '.' && leaderDots && start === s)) return null;
  const rb = text[end];
  if (rb !== undefined && !RIGHT_OK.test(rb)) return null;

  const digits = hasCommas ? intPart.replace(/,/g, '') : intPart;
  if (!hasCommas && !decPart && digits.length >= 9) return null; // account numbers

  const plain = !hasDollar && !hasCommas && !decPart;
  if (plain && !cell) {
    if (digits.length <= 2) return null; // box and line numbers
    const n = Number(digits);
    if (digits.length === 4 && n >= 1900 && n <= 2099) return null; // years
    const lead = text.slice(Math.max(0, start - 40), start);
    if (KEYWORD_BEFORE.test(lead)) return null;
    if (digits.length === 5 && ZIP_BEFORE.test(lead)) return null;
    if (STREET_AFTER.test(text.slice(end, end + 80))) return null;
  }

  let value = Number(decPart ? `${digits}.${decPart}` : digits);
  if ((paren || leadMinus || trailMinus) && value !== 0) value = -value;
  return { start, end, text: text.slice(start, end).replace(/\s+/g, ''), value, decimals: decPart.length };
}
