/**
 * File extraction entry point: one file in, its amounts (with labels and locations) out. Never throws — problems come
 * back as plain-language `warnings` with `amounts: []`.
 *
 * pdf.js is injected: the browser passes its build with the worker already configured; Node tests pass the legacy
 * build. Extraction never configures workers and never touches the network.
 */
import type { FileInput, FileKind, ParsedFile } from '../types';
import { extractPdf } from './pdf';
import { extractSheet } from './sheet';
import { WARNING } from './warnings';

export { findAmounts, parseCellAmount } from './amounts';
export { WARNING } from './warnings';

export interface ExtractDeps {
  pdfjs: typeof import('pdfjs-dist');
}

const EXCEL = new Set(['.xlsx', '.xlsm', '.xls', '.ods']);
const CSV = new Set(['.csv', '.tsv', '.txt']);

export async function extractFile(input: FileInput, deps: ExtractDeps): Promise<ParsedFile> {
  const ext = extensionOf(input.name);
  try {
    if (ext === '.pdf') return await extractPdf(input, deps.pdfjs);
    if (EXCEL.has(ext)) return extractSheet(input, 'excel', ext);
    if (CSV.has(ext)) return extractSheet(input, 'csv', ext);
    return failed(input, guessKind(input.data), WARNING.unsupported);
  } catch {
    return failed(input, ext === '.pdf' ? 'pdf' : EXCEL.has(ext) ? 'excel' : 'csv', WARNING.unreadable);
  }
}

function failed(input: FileInput, kind: FileKind, warning: string): ParsedFile {
  return { id: input.id, name: input.name, size: input.size, kind, amounts: [], warnings: [warning] };
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

/** For files we won't read: a best guess from the first bytes. */
function guessKind(data: ArrayBuffer): FileKind {
  const b = new Uint8Array(data, 0, Math.min(8, data.byteLength));
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf'; // %PDF
  if ((b[0] === 0x50 && b[1] === 0x4b) || (b[0] === 0xd0 && b[1] === 0xcf)) return 'excel'; // zip / OLE
  return 'csv';
}
