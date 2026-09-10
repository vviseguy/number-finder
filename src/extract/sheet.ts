/**
 * Spreadsheet and CSV extraction (SheetJS).
 *
 * Amounts: numeric cells (cached values for formulas) except date- or percent-formatted ones and 9+ digit runs
 * shown without separators (account numbers); plus text cells that are exactly one money string ("$1,234.56",
 * "(75.00)") under the amount rules in amounts.ts. CSV/TSV/TXT cells are all read as text, so "2025-01-15" stays a
 * date string and is never an amount.
 * `text` is the formatted value as shown (whitespace removed), `decimals` counts the shown decimals.
 *
 * Labels: nearest text cell to the LEFT in the same row, and nearest text cell ABOVE in the same column (the header).
 * Both, when they differ: "Schwab · Amount". A "text cell" has a letter and is not itself an amount.
 */
import * as XLSX from 'xlsx';
import type { Amount, FileInput, ParsedFile } from '../types';
import { decimalsOf, parseCellAmount } from './amounts';
import { cleanLabel, hasLetter, joinLabels } from './labels';
import { WARNING } from './warnings';

export const CSV_SHEET = 'CSV';

type CellRead =
  | { kind: 'amount'; value: number; text: string; decimals: number }
  | { kind: 'text'; text: string }
  | { kind: 'skip' };

const SKIP: CellRead = { kind: 'skip' };

export function extractSheet(input: FileInput, kind: 'excel' | 'csv', ext: string): ParsedFile {
  const file: ParsedFile = { id: input.id, name: input.name, size: input.size, kind, sheets: [], amounts: [], warnings: [] };
  let wb: XLSX.WorkBook;
  try {
    wb = kind === 'csv' ? readCsv(input.data, ext) : readWorkbook(input.data, ext);
  } catch (err) {
    file.warnings.push(kind === 'excel' && isPasswordError(input.data, err) ? WARNING.workbookPassword : WARNING.unreadable);
    return file;
  }
  const names = kind === 'csv' ? wb.SheetNames.slice(0, 1) : wb.SheetNames;
  file.sheets = kind === 'csv' ? [CSV_SHEET] : [...names];
  for (const name of names) {
    const sheet = kind === 'csv' ? CSV_SHEET : name;
    for (const a of amountsInSheet(wb.Sheets[name])) {
      const amount: Amount = {
        id: `${input.id}:${file.amounts.length}`,
        fileId: input.id,
        value: a.value,
        text: a.text,
        label: a.label,
        decimals: a.decimals,
        location: { kind: 'sheet', sheet, cell: a.cell },
      };
      file.amounts.push(amount);
    }
  }
  if (!file.amounts.length) file.warnings.push(WARNING.noNumbers);
  return file;
}

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;
const isOle = (b: Uint8Array) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

function readWorkbook(data: ArrayBuffer, ext: string): XLSX.WorkBook {
  const bytes = new Uint8Array(data);
  // .xlsx/.xlsm/.ods are zip files (OLE when encrypted). Old .xls may also be HTML/XML/text, but never binary junk.
  if (!isZip(bytes) && !isOle(bytes) && (ext !== '.xls' || bytes.subarray(0, 4096).includes(0))) throw new Error('not a workbook');
  return XLSX.read(bytes, { type: 'array', cellNF: true, cellText: true, cellDates: false, cellHTML: false, cellFormula: false });
}

function readCsv(data: ArrayBuffer, ext: string): XLSX.WorkBook {
  const opts: XLSX.ParsingOptions = { type: 'string', raw: true, cellText: true };
  // .txt is tab-delimited or one column: splitting prose on commas would turn "Total 1,234.56" into "Total 1" | "234.56".
  if (ext === '.tsv' || ext === '.txt') opts.FS = '\t';
  return XLSX.read(decodeText(data), opts);
}

function decodeText(data: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('windows-1252').decode(data);
  }
}

/** Encrypted workbooks (xlsx and xls alike) are OLE containers; a zip can't be password-protected this way. */
function isPasswordError(data: ArrayBuffer, err: unknown): boolean {
  return isOle(new Uint8Array(data, 0, Math.min(4, data.byteLength))) && err instanceof Error && /password|encrypt/i.test(err.message);
}

interface SheetAmount {
  value: number;
  text: string;
  decimals: number;
  label: string;
  cell: string;
}

/** Row-major, so "nearest text to the left" and "nearest text above" are simply the last ones seen. */
function amountsInSheet(ws: XLSX.WorkSheet | undefined): SheetAmount[] {
  const ref = ws?.['!ref'];
  if (!ws || !ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const header: string[] = [];
  const out: SheetAmount[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    let rowLabel = '';
    for (let c = range.s.c; c <= range.e.c; c++) {
      const address = XLSX.utils.encode_cell({ r, c });
      const cell = ws[address] as XLSX.CellObject | undefined;
      if (!cell) continue;
      const read = readCell(cell);
      if (read.kind === 'amount') {
        out.push({ ...read, label: joinLabels(rowLabel, header[c] ?? ''), cell: address });
      } else if (read.kind === 'text') {
        rowLabel = read.text;
        header[c] = read.text;
      }
    }
  }
  return out;
}

function readCell(cell: XLSX.CellObject): CellRead {
  if (cell.t === 'n') {
    const v = cell.v;
    if (typeof v !== 'number' || !Number.isFinite(v)) return SKIP;
    const format = typeof cell.z === 'string' ? cell.z : '';
    if (format && (XLSX.SSF.is_date(format) || isPercentFormat(format))) return SKIP;
    const shown = (cell.w ?? String(v)).trim();
    if (/^\d{9,}$/.test(shown)) return SKIP;
    // toPrecision(15) drops float noise from cached formula results (3234.5600000000004 → 3234.56).
    return { kind: 'amount', value: Number(v.toPrecision(15)), text: shown.replace(/\s+/g, ''), decimals: decimalsOf(shown) };
  }
  if (cell.t === 's') {
    const raw = typeof cell.v === 'string' ? cell.v : (cell.w ?? '');
    const token = parseCellAmount(raw);
    if (token) return { kind: 'amount', value: token.value, text: token.text, decimals: token.decimals };
    const text = cleanLabel(raw);
    return text && hasLetter(text) ? { kind: 'text', text } : SKIP;
  }
  return SKIP;
}

function isPercentFormat(format: string): boolean {
  return /%/.test(format.replace(/"[^"]*"|\\./g, ''));
}
