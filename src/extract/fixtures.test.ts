// End-to-end extraction on the generated fixtures (node scripts/make-fixtures.mjs).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Amount, FileInput, ParsedFile } from '../types';
import { extractFile } from './index';

const FIXTURES = join(__dirname, '..', '..', 'fixtures');

function fromBytes(name: string, bytes: Uint8Array, id = 'f'): FileInput {
  const data = new Uint8Array(bytes).buffer;
  return { id, name, size: data.byteLength, data };
}
const fixture = (name: string, id = 'f') => fromBytes(name, readFileSync(join(FIXTURES, name)), id);
const extract = (input: FileInput) => extractFile(input, { pdfjs });
const text = (s: string) => new TextEncoder().encode(s);

/** [text, value, decimals, label] per amount. */
const rows = (f: ParsedFile) => f.amounts.map((a) => [a.text, a.value, a.decimals, a.label]);
const pages = (f: ParsedFile) => f.amounts.map((a) => (a.location.kind === 'pdf' ? a.location.page : null));
const cells = (f: ParsedFile) => f.amounts.map((a) => (a.location.kind === 'sheet' ? `${a.location.sheet}!${a.location.cell}` : null));

/** Neither the value nor the digits appear among the amounts. */
function expectAbsent(f: ParsedFile, values: number[]) {
  for (const v of values) {
    expect(
      f.amounts.filter((a: Amount) => Math.abs(a.value) === v),
      `${v} should not be an amount`,
    ).toEqual([]);
  }
}

describe('fixtures', () => {
  it('extracts every fixture in under 3 seconds (including pdf.js start-up)', async () => {
    const t0 = performance.now();
    const results = [];
    for (const name of readdirSync(FIXTURES)) results.push(await extract(fixture(name)));
    const ms = performance.now() - t0;
    expect(results.length).toBeGreaterThanOrEqual(9);
    expect(ms).toBeLessThan(3000);
  });

  it('W-2: captions above values; SSN, EIN, form number, year, ZIPs and PO box are not amounts', async () => {
    const f = await extract(fixture('W-2.pdf', 'w2'));
    expect(f).toMatchObject({ id: 'w2', name: 'W-2.pdf', kind: 'pdf', pageCount: 1, warnings: [] });
    expect(rows(f)).toEqual([
      ['85,000.00', 85000, 2, '1 Wages, tips, other compensation'],
      ['9,102.00', 9102, 2, '2 Federal income tax withheld'],
      ['85,000.00', 85000, 2, '3 Social security wages'],
      ['5,270.00', 5270, 2, '4 Social security tax withheld'],
    ]);
    expect(f.amounts.map((a) => a.id)).toEqual(['w2:0', 'w2:1', 'w2:2', 'w2:3']);
    expect(f.amounts.every((a) => a.fileId === 'w2')).toBe(true);
    expect(pages(f)).toEqual([1, 1, 1, 1]);
    expectAbsent(f, [0, 12, 3456789, 123456789, 1545, 29, 2025, 12345, 6789, 500, 200, 13]);

    // "85,000.00" is drawn at x=310 on baseline 698 in 10 pt Courier (9 glyphs × 6 pt).
    const loc = f.amounts[0].location;
    if (loc.kind !== 'pdf') throw new Error('expected a PDF location');
    const [x, y, w, h] = loc.box;
    expect(x).toBeCloseTo(310, 0);
    expect(w).toBeCloseTo(54, 0);
    expect(y).toBeLessThan(698);
    expect(y + h).toBeGreaterThan(703);
  });

  it('1099-INT: captions left of values; "$" drawn separately is merged', async () => {
    const f = await extract(fixture('1099-INT.pdf'));
    expect(f.warnings).toEqual([]);
    expect(rows(f)).toEqual([
      ['$3,234.56', 3234.56, 2, '1 Interest income'],
      ['$265.44', 265.44, 2, '2 Early withdrawal penalty'],
      ['$0.00', 0, 2, '3 Interest on U.S. Savings Bonds and Treas. obligations'],
      ['$0.00', 0, 2, '4 Federal income tax withheld'],
    ]);
    // The box starts at the "$" (x=330), not at the digits (x=340).
    const loc = f.amounts[0].location;
    expect(loc.kind === 'pdf' && loc.box[0]).toBeCloseTo(330, 0);
    expectAbsent(f, [1545, 112, 1099, 2024, 2025, 12345, 100, 555, 1234, 3456789, 12345678]);
  });

  it('1099-DIV: box captions above values', async () => {
    const f = await extract(fixture('1099-DIV.pdf'));
    expect(rows(f)).toEqual([
      ['$2,000.00', 2000, 2, '1a Total ordinary dividends'],
      ['$1,500.00', 1500, 2, '1b Qualified dividends'],
      ['$350.00', 350, 2, '2a Total capital gain distr.'],
    ]);
    expectAbsent(f, [1250, 1545, 110, 900, 200, 12345, 2024, 2025]);
  });

  it('1040 draft: two pages, whole dollars, labels through leader dots', async () => {
    const f = await extract(fixture('1040 draft.pdf'));
    expect(f).toMatchObject({ pageCount: 2, warnings: [] });
    expect(rows(f)).toEqual([
      ['85,000', 85000, 0, '1a Wages, salaries, tips (Form(s) W-2, box 1)'],
      ['410', 410, 0, '2a Tax-exempt interest'],
      ['3,235', 3235, 0, '2b Taxable interest'],
      ['2,000', 2000, 0, '3b Ordinary dividends'],
      ['90,235', 90235, 0, '9 Total income. Add lines 1z, 2b, 3b, 4b, 5b, 6b, 7, and 8'],
      ['11,874', 11874, 0, '24 Add lines 22 and 23. This is your total tax'],
      ['9,120', 9120, 0, '25a Federal income tax withheld from Form(s) W-2'],
      ['9,120', 9120, 0, '25d Add lines 25a through 25c'],
    ]);
    expect(pages(f)).toEqual([1, 1, 1, 1, 1, 2, 2, 2]);
    expect(f.amounts.map((a) => a.id)).toEqual(['f:0', 'f:1', 'f:2', 'f:3', 'f:4', 'f:5', 'f:6', 'f:7']);
    expectAbsent(f, [1040, 2025, 2026, 1545, 74, 12345, 200, 11320, 1099, 555, 100]);
  });

  it('Schedule B: payer names as labels, long labels capped on a word', async () => {
    const f = await extract(fixture('Schedule B.pdf'));
    expect(rows(f)).toEqual([
      ['3,253', 3253, 0, 'First Federal Credit Union'],
      ['3,235', 3235, 0, '4 Subtract line 3 from line 2. Enter the result here and on Form 1040…'],
      ['2,100', 2100, 0, 'Vanguard'],
    ]);
    expectAbsent(f, [1040, 2025, 1545, 1989]);
  });

  it('scanned PDF (images only) warns instead of finding nothing silently', async () => {
    const f = await extract(fixture('brokerage-summary.pdf'));
    expect(f).toMatchObject({ kind: 'pdf', pageCount: 2, amounts: [] });
    expect(f.warnings).toEqual(['No readable numbers — this looks like a scan']);
  });

  it('password-protected PDF warns and does not throw', async () => {
    const f = await extract(fixture('locked.pdf'));
    expect(f.amounts).toEqual([]);
    expect(f.warnings).toEqual(['This PDF is password-protected. Save a copy without the password and add it again.']);
  });

  it('workpapers.xlsx: numeric cells, cached formulas, money text; dates and percents skipped', async () => {
    const f = await extract(fixture('workpapers.xlsx'));
    expect(f).toMatchObject({ kind: 'excel', sheets: ['Interest', 'Dividends', 'Summary'], warnings: [] });
    expect(cells(f).map((cell, i) => [cell, ...rows(f)[i]])).toEqual([
      ['Interest!B4', '3,500.00', 3500, 2, 'Gross interest'],
      ['Interest!B6', '265.44', 265.44, 2, 'Early withdrawal penalty'],
      ['Interest!D9', '3,234.56', 3234.56, 2, 'Net interest'],
      ['Dividends!B2', '2000', 2000, 0, 'Schwab · Amount'],
      ['Dividends!B3', '100', 100, 0, 'Vanguard · Amount'],
      ['Summary!B3', '3234.56', 3234.56, 2, 'Total interest'],
      ['Summary!B4', '2100', 2100, 0, 'Total dividends'],
      ['Summary!B5', '(75.00)', -75, 2, 'Adjustment'],
      ['Summary!B6', '5334.56', 5334.56, 2, 'Total income'],
    ]);
    expect(cells(f)).not.toContain('Interest!B2'); // 2025-12-31, date-formatted
    expect(cells(f)).not.toContain('Summary!B8'); // 22%, percent-formatted
  });

  it('donations.csv: money strings parsed, dates skipped, sheet named "CSV"', async () => {
    const f = await extract(fixture('donations.csv'));
    expect(f).toMatchObject({ kind: 'csv', sheets: ['CSV'], warnings: [] });
    expect(cells(f).map((cell, i) => [cell, ...rows(f)[i]])).toEqual([
      ['CSV!C2', '$250.00', 250, 2, 'Red Cross · Amount'],
      ['CSV!C3', '125', 125, 0, 'Food Bank · Amount'],
      ['CSV!C4', '$1,045.50', 1045.5, 2, 'Animal Shelter · Amount'],
      ['CSV!C5', '(20.00)', -20, 2, 'Library Fund · Amount'],
    ]);
  });
});

describe('dispatch and failures (never throws)', () => {
  it('matches extensions case-insensitively', async () => {
    const f = await extract(fromBytes('W-2.PDF', readFileSync(join(FIXTURES, 'W-2.pdf'))));
    expect(f.amounts).toHaveLength(4);
  });

  it('reads TSV', async () => {
    const f = await extract(fromBytes('items.tsv', text('Item\tAmount\nBook\t$12.50\n')));
    expect(rows(f)).toEqual([['$12.50', 12.5, 2, 'Book · Amount']]);
  });

  it.each([
    ['broken.pdf', text('%PDF-1.7\nthis is not really a pdf\n'), 'pdf'],
    ['random.pdf', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'pdf'],
    ['broken.xlsx', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]), 'excel'],
    ['notes.xlsx', text('just some text, not a workbook'), 'excel'],
    ['junk.xls', new Uint8Array([0, 1, 2, 3, 255, 254, 0, 0]), 'excel'],
  ] as const)('%s → "Couldn\'t read this file."', async (name, bytes, kind) => {
    const f = await extract(fromBytes(name, bytes));
    expect(f).toMatchObject({ name, kind, amounts: [], warnings: ["Couldn't read this file."] });
  });

  it('readable files without numbers say so', async () => {
    const f = await extract(fromBytes('notes.csv', text('Name,Notes\nPat,hello\n')));
    expect(f.amounts).toEqual([]);
    expect(f.warnings).toEqual(['No numbers found in this file.']);
  });

  it('unsupported kinds get a plain-language warning and a best-guess kind', async () => {
    const jpg = await extract(fromBytes('photo.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0])));
    expect(jpg).toMatchObject({ kind: 'csv', amounts: [], warnings: ["Number finder can't read this kind of file. Use PDF, Excel, or CSV."] });
    const pdfish = await extract(fromBytes('statement.bin', readFileSync(join(FIXTURES, 'W-2.pdf'))));
    expect(pdfish).toMatchObject({ kind: 'pdf', amounts: [] });
  });
});
