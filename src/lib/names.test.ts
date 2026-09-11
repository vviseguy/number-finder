import { describe, expect, test } from 'vitest';
import { shortName, shortNames } from './names';

describe('shortNames', () => {
  test('short names are left alone', () => {
    const m = shortNames(['W-2.pdf', '1099-INT.pdf', 'workpapers.xlsx']);
    expect([...m.values()]).toEqual(['W-2.pdf', '1099-INT.pdf', 'workpapers.xlsx']);
  });

  test('words shared by every file are dropped, keeping what differs', () => {
    const m = shortNames(['Alpha Client 2025 Bank Statement Jan.pdf', 'Alpha Client 2025 Bank Statement Feb.pdf']);
    expect(m.get('Alpha Client 2025 Bank Statement Jan.pdf')).toBe('…Jan.pdf');
    expect(m.get('Alpha Client 2025 Bank Statement Feb.pdf')).toBe('…Feb.pdf');
  });

  test('two clients, two months: both differences survive', () => {
    const names = [
      'Alpha Client 2025 Bank Statement Jan.pdf', 'Alpha Client 2025 Bank Statement Feb.pdf',
      'Beta Client 2025 Bank Statement Jan.pdf', 'Beta Client 2025 Bank Statement Feb.pdf',
    ];
    expect([...shortNames(names).values()]).toEqual(['Alpha…Jan.pdf', 'Alpha…Feb.pdf', 'Beta…Jan.pdf', 'Beta…Feb.pdf']);
  });

  test('hyphenated codes stay whole', () => {
    const m = shortNames(['Alpha Client 2025 1099-INT Chase final.pdf', 'Alpha Client 2025 1099-DIV Chase final.pdf']);
    expect(m.get('Alpha Client 2025 1099-INT Chase final.pdf')).toBe('…1099-INT….pdf');
    expect(m.get('Alpha Client 2025 1099-DIV Chase final.pdf')).toBe('…1099-DIV….pdf');
  });

  test('shared words in the middle become one … each', () => {
    const m = shortNames(['Statement January 2025 final.pdf', 'Statement June 2025 final.pdf']);
    expect(m.get('Statement January 2025 final.pdf')).toBe('…January….pdf');
    expect(m.get('Statement June 2025 final.pdf')).toBe('…June….pdf');
  });

  test('a long name with no siblings is trimmed in the middle, keeping the extension', () => {
    const s = shortName('A very long workbook name for the year 2025.xlsx', []);
    expect(s.length).toBeLessThanOrEqual(24);
    expect(s.endsWith('.xlsx')).toBe(true);
    expect(s).toContain('…');
    expect(s.startsWith('A very')).toBe(true);
  });

  test('a still-too-long distinct part is trimmed in the middle', () => {
    const s = shortName('Client Alpha statement for the whole calendar year of 2025 draft.pdf', ['Client Alpha 2024 draft.pdf']);
    expect(s.length).toBeLessThanOrEqual(24);
    expect(s.endsWith('.pdf')).toBe(true);
    expect(s.startsWith('…')).toBe(true);
  });

  test('copies that differ only by (1) and (2) still tell apart', () => {
    const m = shortNames(['Alpha Client 2025 Bank Statement Jan (1).pdf', 'Alpha Client 2025 Bank Statement Jan (2).pdf']);
    expect([...m.values()]).toEqual(['…(1).pdf', '…(2).pdf']);
  });

  test('names made of the same words are trimmed, and stay distinct', () => {
    const a = 'Alpha Client 2025 Bank Statement Jan.pdf';
    const b = 'Alpha Client 2025 Bank Statement Jan.xlsx';
    const m = shortNames([a, b]);
    expect(m.get(a)).not.toBe(m.get(b));
    expect(m.get(a)!.endsWith('.pdf')).toBe(true);
    expect(m.get(b)!.endsWith('.xlsx')).toBe(true);
  });

  test('unrelated long names are trimmed in the middle, not blended', () => {
    const m = shortNames(['Brokerage summary statement December 2025.pdf', 'Charity donations spreadsheet for taxes.csv']);
    for (const [name, short] of m) {
      expect(short.length).toBeLessThanOrEqual(24);
      expect(short.endsWith(name.slice(name.lastIndexOf('.')))).toBe(true);
      expect(short).not.toMatch(/^…/);
    }
  });
});
