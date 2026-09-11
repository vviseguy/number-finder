// Shared contracts between file extraction (src/extract), the search engine (src/engine), and the UI.
// Change these only deliberately: all three sides code against them.

// ---------- Files and the amounts found in them ----------

export type FileKind = 'pdf' | 'excel' | 'csv';

/**
 * Where an amount sits in its file.
 * PDF boxes are in PDF user-space units of that page (origin bottom-left): [x, y, width, height].
 * Sheet cells are A1 addresses ("D14"); CSV files use sheet name "CSV".
 */
export type Location =
  | { kind: 'pdf'; page: number; box: [number, number, number, number] }
  | { kind: 'sheet'; sheet: string; cell: string };

export interface Amount {
  /** Unique within a session: `${fileId}:${index}`. */
  id: string;
  fileId: string;
  /** Parsed value. Accounting negatives "(75.00)" and trailing minus "75.00-" are negative. */
  value: number;
  /** Text as it appears in the file, e.g. "$3,234.56". */
  text: string;
  /** Nearby label, e.g. "Box 1 · Interest income". '' when nothing sensible is nearby. */
  label: string;
  /** Decimal places as written (0 for whole dollars like "3,235"). */
  decimals: number;
  location: Location;
}

export interface ParsedFile {
  id: string;
  name: string;
  size: number;
  kind: FileKind;
  /** PDFs only. */
  pageCount?: number;
  /** Excel/CSV only: sheet names in workbook order. */
  sheets?: string[];
  /** In reading order: page by page (top to bottom, left to right) or sheet by sheet (row-major). */
  amounts: Amount[];
  /** Plain-language notices for the file list, e.g. "No readable numbers — this looks like a scan". */
  warnings: string[];
}

/** What extraction receives. In the browser this comes from a dropped File. */
export interface FileInput {
  id: string;
  name: string;
  size: number;
  data: ArrayBuffer;
}

// ---------- Searching ----------

export type Rounding = 'exact' | 'cent' | 'dollar';
export const ROUNDING_TOLERANCE: Record<Rounding, number> = { exact: 0, cent: 0.01, dollar: 0.5 };

/** Per-file limit inside a group: at least `min`, at most `max` (null = no limit) numbers from that file. */
export interface FileLimit {
  min: number;
  max: number | null;
}

/** The subset of Amount the engine needs. Keep `id` so results map back to locations. */
export interface Candidate {
  id: string;
  fileId: string;
  value: number;
}

export interface SearchRequest {
  target: number;
  /** Fewest numbers that may combine (default 1). minCount = maxCount = 3 means "sums of exactly 3". */
  minCount?: number;
  /** Most numbers that may combine: 1 = exact lookup; null = any count. */
  maxCount: number | null;
  /** Any number may count as negative. With maxCount 1 this means matching ±target. */
  allowFlips: boolean;
  /** With allowFlips: at most this many numbers in a match may count as negative (null/undefined = no limit). */
  maxFlips?: number | null;
  /** |sum − target| ≤ tolerance counts as a match. */
  tolerance: number;
  candidates: Candidate[];
  /** By fileId. A file missing from this map has no limit. */
  limits: Record<string, FileLimit>;
  /** Stop after this many matches. */
  maxResults: number;
  timeLimitMs: number;
}

export interface MatchItem {
  id: string;
  sign: 1 | -1;
}

export interface Match {
  items: MatchItem[];
  /** Signed sum of the items. */
  sum: number;
  /** sum − target. */
  diff: number;
}

/** Closest single candidate to the target, reported when nothing matched. */
export interface Nearest {
  id: string;
  sign: 1 | -1;
  /** (sign × value) − target. */
  diff: number;
}

export type DoneReason = 'exhausted' | 'timeLimit' | 'stopped' | 'maxResults' | 'invalid';

export type EngineEvent =
  | { type: 'progress'; elapsedMs: number; found: number; /** 0–1 when knowable, else null. */ fraction: number | null }
  | { type: 'match'; match: Match }
  | { type: 'done'; reason: DoneReason; matches: Match[]; nearest: Nearest | null; detail?: string };
