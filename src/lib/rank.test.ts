import { describe, expect, test } from 'vitest';
import { sortMatches, type ItemInfo } from './rank';
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
  test('is stable and leaves the input alone', () => {
    const copy = found.slice();
    sortMatches(found, 'best', parseQuery('100').terms, info);
    expect(found).toEqual(copy);
  });
});
