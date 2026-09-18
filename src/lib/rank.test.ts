import { describe, expect, test } from 'vitest';
import { DEFAULT_GROUPING, groupingOf, sortMatches, type ItemInfo } from './rank';
import { parseQuery } from './query';
import type { Match } from '../types';

// Three files, a few numbers each. Ids are "<file>:<index>".
const INFO: Record<string, ItemInfo> = {
  'a:0': { fileOrder: 0, position: 0, fileLabel: 'W-2.pdf', text: 'box 1 wages w-2.pdf' },
  'a:1': { fileOrder: 0, position: 1, fileLabel: 'W-2.pdf', text: 'box 2 withheld w-2.pdf' },
  'b:0': { fileOrder: 1, position: 0, fileLabel: '1099-INT.pdf', text: 'box 1 interest income 1099-int.pdf 2025' },
  'c:0': { fileOrder: 2, position: 0, fileLabel: 'Workpapers.xlsx', text: 'total workpapers.xlsx summary' },
  'c:1': { fileOrder: 2, position: 1, fileLabel: 'Workpapers.xlsx', text: 'penalty workpapers.xlsx summary' },
};
const info = (id: string) => INFO[id];
const one = (id: string, diff = 0): Match => ({ items: [{ id, sign: 1 }], sum: 100 + diff, diff });
const pair = (x: string, y: string, flip = false, diff = 0): Match => ({ items: [{ id: x, sign: 1 }, { id: y, sign: flip ? -1 : 1 }], sum: 100 + diff, diff });
const ids = (ms: Match[]) => ms.map(m => m.items.map(i => i.id).join('+'));
const triple = (x: string, y: string, z: string): Match => ({ items: [x, y, z].map(id => ({ id, sign: 1 as const })), sum: 100, diff: 0 });

describe('search mode (sums only)', () => {
  // W-2: two numbers side by side on page 1 and one on page 2; one number each in 1099-INT and 1099-DIV.
  const GI: Record<string, ItemInfo> = {
    'w:0': { fileOrder: 0, position: 0, section: 'p1', fileLabel: 'W-2.pdf', text: '' },
    'w:1': { fileOrder: 0, position: 1, section: 'p1', fileLabel: 'W-2.pdf', text: '' },
    'w:9': { fileOrder: 0, position: 9, section: 'p2', fileLabel: 'W-2.pdf', text: '' },
    'i:0': { fileOrder: 1, position: 0, section: 'p1', fileLabel: '1099-INT.pdf', text: '' },
    'd:0': { fileOrder: 2, position: 0, section: 'p1', fileLabel: '1099-DIV.pdf', text: '' },
  };
  const gi = (id: string) => GI[id];
  const ms = [pair('w:0', 'w:9'), pair('w:0', 'w:1'), pair('w:0', 'i:0'), triple('w:1', 'i:0', 'd:0'), one('d:0')];
  const t = parseQuery('100').terms;

  test('clumped: one file, one page, side by side first', () => {
    expect(ids(sortMatches(ms, 'best', t, gi, 'clumped'))).toEqual(['d:0', 'w:0+w:1', 'w:0+w:9', 'w:0+i:0', 'w:1+i:0+d:0']);
  });
  test('spread: one file, far apart first', () => {
    expect(ids(sortMatches(ms, 'best', t, gi, 'spread'))).toEqual(['d:0', 'w:0+w:9', 'w:0+w:1', 'w:0+i:0', 'w:1+i:0+d:0']);
  });
  test('across files: one number per file first, then fewest numbers', () => {
    expect(ids(sortMatches(ms, 'best', t, gi, 'across'))).toEqual(['d:0', 'w:0+i:0', 'w:1+i:0+d:0', 'w:0+w:9', 'w:0+w:1']);
  });
  test('single numbers always come first', () => {
    for (const g of ['clumped', 'spread', 'across'] as const) expect(ids(sortMatches(ms, 'best', t, gi, g))[0]).toBe('d:0');
  });
});

describe('rows', () => {
  // A wide printed row: boxes 1 and 5 sit on one line with three numbers between them in reading order.
  const RI: Record<string, ItemInfo> = {
    'w:0': { fileOrder: 0, position: 0, section: 'p1', row: 'r0', fileLabel: 'W-2.pdf', text: '' },
    'w:5': { fileOrder: 0, position: 5, section: 'p1', row: 'r0', fileLabel: 'W-2.pdf', text: '' },
    'w:6': { fileOrder: 0, position: 6, section: 'p1', row: 'r1', fileLabel: 'W-2.pdf', text: '' },
    'i:0': { fileOrder: 1, position: 0, section: 'p1', row: 'r0', fileLabel: '1099-INT.pdf', text: '' },
  };
  const ri = (id: string) => RI[id];
  const t = parseQuery('100').terms;
  const ms = [pair('w:5', 'w:6'), pair('w:0', 'w:5'), pair('w:5', 'i:0')];

  test('clumped: one row beats neighbours on two rows, even when they read closer together', () => {
    expect(ids(sortMatches(ms, 'best', t, ri, 'clumped'))).toEqual(['w:0+w:5', 'w:5+w:6', 'w:5+i:0']);
  });
  test('most spread: the opposite order, different files first', () => {
    expect(ids(sortMatches(ms, 'best', t, ri, 'scattered'))).toEqual(['w:5+i:0', 'w:5+w:6', 'w:0+w:5']);
  });
  test('clumped is the mode searches start in', () => {
    expect(DEFAULT_GROUPING).toBe('clumped');
    expect(groupingOf({})).toBe('clumped');
  });
});

describe('sortMatches', () => {
  const found = [pair('a:0', 'c:0'), one('c:0', 0.4), pair('c:0', 'c:1', true), one('b:0', 0.1), one('a:1')];

  test('best: singles first, then fewer negatives, then closest', () => {
    expect(ids(sortMatches(found, 'best', parseQuery('100').terms, info))).toEqual(['a:1', 'b:0', 'c:0', 'a:0+c:0', 'c:0+c:1']);
  });
  test("a 'preferred word moves matches that mention it up, within the same size", () => {
    const terms = parseQuery("100 '2025").terms;
    expect(ids(sortMatches(found, 'best', terms, info))).toEqual(['b:0', 'a:1', 'c:0', 'a:0+c:0', 'c:0+c:1']);
    const t2 = parseQuery("100 'summary").terms;
    expect(ids(sortMatches(found, 'best', t2, info))).toEqual(['c:0', 'a:1', 'b:0', 'a:0+c:0', 'c:0+c:1']);
  });
  test('closest: by difference, whatever the size', () => {
    expect(ids(sortMatches(found, 'closest', parseQuery('100').terms, info))).toEqual(['a:1', 'a:0+c:0', 'c:0+c:1', 'b:0', 'c:0']);
  });
  test('file: alphabetical by file as shown, then position (a sum sits at its earliest number)', () => {
    expect(ids(sortMatches(found, 'file', parseQuery('100').terms, info))).toEqual(['b:0', 'a:0+c:0', 'a:1', 'c:0', 'c:0+c:1']);
  });
  test('position: files in the order added, then reading order; a sum sits at its earliest number', () => {
    expect(ids(sortMatches(found, 'position', parseQuery('100').terms, info))).toEqual(['a:0+c:0', 'a:1', 'b:0', 'c:0', 'c:0+c:1']);
  });
  test('without a search mode, sums keep the old order (fewest numbers first)', () => {
    expect(ids(sortMatches(found, 'best', parseQuery('100').terms, info, undefined))).toEqual(ids(sortMatches(found, 'best', parseQuery('100').terms, info)));
  });
  test('is stable and leaves the input alone', () => {
    const copy = found.slice();
    sortMatches(found, 'best', parseQuery('100').terms, info);
    expect(found).toEqual(copy);
  });
});
