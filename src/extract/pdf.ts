/**
 * PDF extraction: pdf.js text items → lines → amounts with labels and highlight boxes.
 *
 * Lines: horizontal text items whose baselines are within 0.3 em are one line, read left to right. Between items we
 * insert nothing (touching — so "$", "3,234", ".56" merge into one number), a space (small gap), or a TAB when the gap
 * is wider than 2 em (a column break). Rotated items are lines of their own.
 *
 * Labels (the name a person would read for the number):
 *   1. Text on the same line to the LEFT, if it is close (≤ 4 em) or joined by leader dots ("Wages . . . . 1a 85,000").
 *   2. Else a caption just ABOVE (≤ 2.6 em up, horizontally overlapping) — box-style forms like the W-2 — unless the
 *      amount heads a column of amounts (then that text above is a column header and the row text wins).
 *   3. Else farther text on the same line to the left (≤ 75% of the page width).
 *   4. Else the nearest text above within 5 em (column headers).
 *   Bare box/line numbers ("1a", "2b") are skipped when looking left, then put in front of a label that has none
 *   ("b Taxable interest" + "2b" → "2b Taxable interest"). Wrapped captions climb up to two more lines.
 */
import type { Amount, FileInput, ParsedFile } from '../types';
import { findAmounts, type AmountToken } from './amounts';
import { capLabel, cleanLabel, hasLetter, isBoxNumber, splitLeaders, startsWithBoxNumber, withBoxNumber } from './labels';
import { WARNING, blankPagesWarning, failedPagesWarning } from './warnings';

type PdfJs = typeof import('pdfjs-dist');

/** The parts of a pdf.js TextItem we use (so layout can be unit-tested with plain objects). */
export interface RawTextItem {
  str: string;
  /** [a, b, c, d, e, f] in PDF user space; (e, f) is the baseline origin. */
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
}
export type RawTextStyles = Record<string, { ascent?: number; descent?: number } | undefined>;

export interface PageAmount {
  token: AmountToken;
  label: string;
  /** [x, y, width, height] in PDF user space (origin bottom-left). */
  box: [number, number, number, number];
}

type Rect = [number, number, number, number]; // x0, y0, x1, y1

interface Piece {
  str: string;
  x0: number;
  x1: number;
  y: number;
  fs: number;
  rects: Rect[];
  horizontal: boolean;
}

interface Line {
  y: number;
  x0: number;
  text: string;
  /** Per character (UTF-16 unit); null for separators we inserted. */
  rects: (Rect | null)[];
  /** Per character font size. */
  sizes: number[];
}

interface Run {
  text: string;
  rect: Rect;
  fs: number;
  letters: boolean;
  box: boolean;
}

interface Found {
  token: AmountToken;
  rect: Rect;
  fs: number;
  line: number;
}

/** Offline, text-only options: no font loading, no workers fetching cMaps/fonts/wasm, no streaming. */
function documentOptions(data: Uint8Array) {
  return {
    data,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    useWasm: false,
    isOffscreenCanvasSupported: false,
    enableXfa: false,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    stopAtErrors: false,
    verbosity: 0, // errors only
  };
}

export async function extractPdf(input: FileInput, pdfjs: PdfJs): Promise<ParsedFile> {
  const file: ParsedFile = { id: input.id, name: input.name, size: input.size, kind: 'pdf', amounts: [], warnings: [] };
  let task: ReturnType<PdfJs['getDocument']> | undefined;
  try {
    // pdf.js may transfer (detach) the buffer it is given; hand it a copy so the caller can still render the file.
    task = pdfjs.getDocument(documentOptions(new Uint8Array(input.data.slice(0))));
    const doc = await task.promise;
    file.pageCount = doc.numPages;
    const blank: number[] = [];
    const failed: number[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      let page;
      try {
        page = await doc.getPage(n);
        const content = await page.getTextContent();
        const items = content.items.filter((it): it is RawTextItem & (typeof content.items)[number] => 'str' in it);
        const width = page.view[2] - page.view[0];
        const { amounts, hasText } = amountsOnPage(items, content.styles, width);
        if (!hasText) blank.push(n);
        for (const a of amounts) file.amounts.push(toAmount(input.id, file.amounts.length, n, a));
      } catch {
        failed.push(n);
      } finally {
        page?.cleanup();
      }
    }
    if (doc.numPages > 0 && blank.length === doc.numPages) file.warnings.push(WARNING.scan);
    else {
      if (blank.length) file.warnings.push(blankPagesWarning(blank));
      if (failed.length) file.warnings.push(failedPagesWarning(failed));
      if (!file.amounts.length) file.warnings.push(WARNING.noNumbers);
    }
  } catch (err) {
    file.amounts = [];
    file.warnings = [isPasswordError(err, pdfjs) ? WARNING.pdfPassword : WARNING.unreadable];
  } finally {
    await task?.destroy().catch(() => undefined);
  }
  return file;
}

function isPasswordError(err: unknown, pdfjs: PdfJs): boolean {
  if (pdfjs.PasswordException && err instanceof pdfjs.PasswordException) return true;
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'PasswordException';
}

function toAmount(fileId: string, index: number, page: number, a: PageAmount): Amount {
  return {
    id: `${fileId}:${index}`,
    fileId,
    value: a.token.value,
    text: a.token.text,
    label: a.label,
    decimals: a.token.decimals,
    location: { kind: 'pdf', page, box: a.box },
  };
}

/** Amounts on one page in reading order (top→bottom, left→right), with labels and boxes. */
export function amountsOnPage(
  items: RawTextItem[],
  styles: RawTextStyles,
  pageWidth: number,
): { amounts: PageAmount[]; hasText: boolean } {
  const pieces: Piece[] = [];
  for (const item of items) {
    const p = toPiece(item, styles);
    if (p) pieces.push(p);
  }
  if (!pieces.length) return { amounts: [], hasText: false };

  const lines = buildLines(pieces);
  const found: Found[][] = [];
  const runs: Run[][] = [];
  lines.forEach((line, i) => {
    const tokens = findAmounts(line.text);
    found.push(
      tokens.flatMap((token) => {
        const rect = unionRect(line, token.start, token.end);
        return rect ? [{ token, rect, fs: maxSize(line, token.start, token.end), line: i }] : [];
      }),
    );
    runs.push(runsOf(line, tokens));
  });

  const amounts: PageAmount[] = [];
  for (const row of found) {
    for (const f of row) {
      const [x0, y0, x1, y1] = f.rect;
      amounts.push({
        token: f.token,
        label: labelFor(f, lines, runs, found, pageWidth),
        box: [round2(x0), round2(y0), round2(x1 - x0), round2(y1 - y0)],
      });
    }
  }
  return { amounts, hasText: true };
}

// ---------- geometry ----------

function toPiece(item: RawTextItem, styles: RawTextStyles): Piece | null {
  const str = item.str;
  if (!str || !str.trim() || !Array.isArray(item.transform)) return null;
  const [a, b, c, d, e, f] = item.transform;
  const sx = Math.hypot(a, b);
  const sy = Math.hypot(c, d);
  if (!(sx > 0) || !(sy > 0) || !Number.isFinite(e) || !Number.isFinite(f)) return null;
  const ux = a / sx;
  const uy = b / sx;
  const nx = c / sy;
  const ny = d / sy;
  const style = item.fontName ? styles[item.fontName] : undefined;
  const asc = style?.ascent && style.ascent > 0.3 && style.ascent < 1.5 ? style.ascent : 0.8;
  const desc = style?.descent && style.descent < 0 && style.descent > -0.8 ? style.descent : -0.2;
  const width = item.width > 0 ? item.width : 0.5 * sx * str.length;
  const n = str.length;
  const rects: Rect[] = [];
  for (let i = 0; i < n; i++) {
    rects.push(rectAlong(e, f, ux, uy, nx, ny, (width * i) / n, (width * (i + 1)) / n, desc * sy, asc * sy));
  }
  return { str, x0: e, x1: e + width * ux, y: f, fs: sy, rects, horizontal: Math.abs(uy) < 0.02 && ux > 0 && ny > 0 };
}

/** Axis-aligned box around the glyph strip from t0 to t1 along the text direction. */
function rectAlong(ox: number, oy: number, ux: number, uy: number, nx: number, ny: number, t0: number, t1: number, h0: number, h1: number): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const t of [t0, t1]) {
    for (const h of [h0, h1]) {
      const x = ox + ux * t + nx * h;
      const y = oy + uy * t + ny * h;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return [x0, y0, x1, y1];
}

function buildLines(pieces: Piece[]): Line[] {
  const horizontal = pieces.filter((p) => p.horizontal).sort((p, q) => q.y - p.y || p.x0 - q.x0);
  const groups: Piece[][] = [];
  let current: Piece[] = [];
  let anchorY = 0;
  let anchorFs = 0;
  for (const p of horizontal) {
    if (current.length && Math.abs(anchorY - p.y) <= 0.3 * Math.min(anchorFs, p.fs)) {
      current.push(p);
      anchorFs = Math.max(anchorFs, p.fs);
    } else {
      if (current.length) groups.push(current);
      current = [p];
      anchorY = p.y;
      anchorFs = p.fs;
    }
  }
  if (current.length) groups.push(current);
  const lines = groups.map(joinPieces);
  for (const p of pieces) if (!p.horizontal) lines.push(joinPieces([p]));
  return lines.sort((l, m) => m.y - l.y || l.x0 - m.x0);
}

function joinPieces(group: Piece[]): Line {
  const ps = [...group].sort((p, q) => p.x0 - q.x0);
  let text = '';
  const rects: (Rect | null)[] = [];
  const sizes: number[] = [];
  let prev: Piece | null = null;
  let y = ps[0].y;
  let yFs = 0;
  for (const p of ps) {
    if (prev) {
      const em = Math.max(prev.fs, p.fs);
      // Simulated bold: the same text drawn twice a hair apart.
      if (p.str === prev.str && Math.abs(p.x0 - prev.x0) < 0.25 * em) continue;
      const gap = p.x0 - prev.x1;
      const l = text[text.length - 1] ?? '';
      const r = p.str[0] ?? '';
      const numeric = /[\d.,]/.test(l) && /[\d.,]/.test(r);
      let sep = '';
      if (gap > 2 * em) sep = '\t';
      else if (gap > (numeric ? 0.25 : 0.15) * em && !/\s/.test(l) && !/\s/.test(r)) sep = ' ';
      for (let k = 0; k < sep.length; k++) {
        rects.push(null);
        sizes.push(em);
      }
      text += sep;
    }
    // A wide run of spaces inside one item is a column break too (same length, so indexes stay aligned).
    text += p.str.replace(/ {3,}/g, (m) => '\t'.repeat(m.length));
    for (const r of p.rects) {
      rects.push(r);
      sizes.push(p.fs);
    }
    if (p.fs > yFs) {
      yFs = p.fs;
      y = p.y;
    }
    prev = p;
  }
  return { y, x0: ps[0].x0, text, rects, sizes };
}

function unionRect(line: Line, start: number, end: number): Rect | null {
  let out: Rect | null = null;
  for (let k = start; k < end; k++) {
    const r = line.rects[k];
    if (!r || /\s/.test(line.text[k])) continue;
    out = out ? [Math.min(out[0], r[0]), Math.min(out[1], r[1]), Math.max(out[2], r[2]), Math.max(out[3], r[3])] : [...r];
  }
  return out;
}

function maxSize(line: Line, start: number, end: number): number {
  let fs = 0;
  for (let k = start; k < end; k++) fs = Math.max(fs, line.sizes[k] ?? 0);
  return fs || 10;
}

/** Stretches of text between amounts and column breaks. */
function runsOf(line: Line, tokens: AmountToken[]): Run[] {
  const n = line.text.length;
  const blocked = new Uint8Array(n);
  for (const t of tokens) blocked.fill(1, t.start, t.end);
  const runs: Run[] = [];
  let i = 0;
  while (i < n) {
    if (blocked[i] || line.text[i] === '\t') {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !blocked[j] && line.text[j] !== '\t') j++;
    const text = line.text.slice(i, j).replace(/\s+/g, ' ').trim();
    const rect = text ? unionRect(line, i, j) : null;
    if (rect) runs.push({ text, rect, fs: maxSize(line, i, j), letters: hasLetter(text), box: isBoxNumber(text) });
    i = j;
  }
  return runs;
}

// ---------- labels ----------

function labelFor(f: Found, lines: Line[], runs: Run[][], found: Found[][], pageWidth: number): string {
  const tx0 = f.rect[0];
  const fs = f.fs;
  let box = '';
  let left: { text: string; gap: number; leaders: boolean } | null = null;
  const toLeft = runs[f.line].filter((r) => r.rect[2] <= tx0 + 0.25 * fs).sort((p, q) => q.rect[2] - p.rect[2]);
  for (const r of toLeft) {
    if (r.box) {
      if (!box) box = r.text;
      continue;
    }
    if (!r.letters) continue;
    const split = splitLeaders(r.text);
    const text = cleanLabel(split.text);
    if (!hasLetter(text)) continue;
    if (split.box && !box) box = split.box;
    left = { text, gap: tx0 - r.rect[2], leaders: split.leaders };
    break;
  }
  const finish = (text: string) => capLabel(withBoxNumber(text, box));

  if (left && (left.leaders || left.gap <= 4 * fs)) return finish(left.text);
  const tight = captionAbove(f, lines, runs, 2.6 * fs, 0.5 * fs);
  if (tight && !amountBelow(f, lines, found, 2.6 * fs)) return finish(tight);
  if (left && left.gap <= 0.75 * pageWidth) return finish(left.text);
  const loose = captionAbove(f, lines, runs, 5 * fs, 3 * fs);
  if (loose) return finish(loose);
  return finish('');
}

function captionAbove(f: Found, lines: Line[], runs: Run[][], maxDy: number, maxDx: number): string | null {
  const [tx0, , tx1] = f.rect;
  const y = lines[f.line].y;
  let best: { line: number; run: Run } | null = null;
  let bestScore = Infinity;
  for (let i = f.line - 1; i >= 0; i--) {
    const dy = lines[i].y - y;
    if (dy > maxDy) break;
    if (dy <= 0.3 * f.fs) continue;
    for (const r of runs[i]) {
      if (!r.letters || r.box) continue;
      const dx = Math.max(0, r.rect[0] - tx1, tx0 - r.rect[2]);
      if (dx > maxDx) continue;
      const score = dy + 1.5 * dx;
      if (score < bestScore) {
        bestScore = score;
        best = { line: i, run: r };
      }
    }
  }
  if (!best) return null;
  // A caption that wraps onto more lines: climb while the line just above continues it (same size, overlapping).
  const parts = [best.run.text];
  let cur = best;
  for (let k = 0; k < 2 && !startsWithBoxNumber(parts[0]); k++) {
    const next = runJustAbove(cur, lines, runs);
    if (!next) break;
    parts.unshift(next.run.text);
    cur = next;
  }
  return cleanLabel(parts.join(' ')) || null;
}

function runJustAbove(cur: { line: number; run: Run }, lines: Line[], runs: Run[][]): { line: number; run: Run } | null {
  const fs = cur.run.fs;
  const y = lines[cur.line].y;
  for (let i = cur.line - 1; i >= 0; i--) {
    const dy = lines[i].y - y;
    if (dy > 1.5 * fs) break;
    if (dy <= 0.3 * fs) continue;
    for (const r of runs[i]) {
      if (!r.letters || r.box || Math.abs(r.fs - fs) > 0.25 * fs) continue;
      if (r.rect[0] <= cur.run.rect[2] + 0.5 * fs && r.rect[2] >= cur.run.rect[0] - 0.5 * fs) return { line: i, run: r };
    }
  }
  return null;
}

/** Is there another amount just below, in the same column? Then text above is a column header, not a caption. */
function amountBelow(f: Found, lines: Line[], found: Found[][], maxDy: number): boolean {
  const y = lines[f.line].y;
  const tol = 0.5 * f.fs;
  for (let j = f.line + 1; j < lines.length; j++) {
    const dy = y - lines[j].y;
    if (dy > maxDy) break;
    if (dy <= 0.3 * f.fs) continue;
    if (found[j].some((g) => g.rect[0] <= f.rect[2] + tol && g.rect[2] >= f.rect[0] - tol)) return true;
  }
  return false;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
