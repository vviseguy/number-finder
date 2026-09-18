import { expect, test } from 'vitest';
import { lookalikeItems } from './lookalike';
import type { Match } from '../types';

// A W-2 with 85,000 in two boxes, and two files that both hold 3,235.
const VALUE: Record<string, number> = { 'w:0': 85_000, 'w:2': 85_000, 'w:1': 9_102, 'd:0': 2_000, 'r:0': 3_235, 'b:1': 3_235 };
const sum = (...ids: string[]): Match => ({ items: ids.map(id => ({ id, sign: 1 as const })), sum: 0, diff: 0 });
/** What the list shows for a sum of three: how many numbers, and the numbers themselves. */
const face = (m: Match) => `Sum of ${m.items.length}: ${m.items.map(it => VALUE[it.id]).join('+')}`;
const ids = (map: Map<string, string[]>) => [...map.keys()].sort();

test('marks the numbers that two look-alike matches differ in', () => {
  const found = [sum('w:0', 'd:0', 'r:0'), sum('w:2', 'd:0', 'r:0'), sum('w:1', 'd:0', 'r:0')];
  expect(ids(lookalikeItems(found, face))).toEqual(['w:0', 'w:2']); // 9,102 reads differently, so it needs no word
  expect(lookalikeItems(found, face).get('w:0')).toEqual(['w:0', 'w:2']); // and what it is told apart from
});

test('marks numbers from different files when the list does not name them', () => {
  const found = [sum('w:0', 'd:0', 'r:0'), sum('w:0', 'd:0', 'b:1')];
  expect(ids(lookalikeItems(found, face))).toEqual(['b:1', 'r:0']);
});

test('marks every place that differs, and leaves the rest alone', () => {
  const found = [sum('w:0', 'd:0', 'r:0'), sum('w:2', 'd:0', 'b:1')];
  expect(ids(lookalikeItems(found, face))).toEqual(['b:1', 'r:0', 'w:0', 'w:2']);
});

test('says nothing when matches already read differently', () => {
  expect(lookalikeItems([sum('w:0', 'd:0'), sum('w:1', 'd:0')], face).size).toBe(0);
  expect(lookalikeItems([sum('w:0', 'd:0')], face).size).toBe(0);
});

test('single numbers are never marked: their row already names the file, place and label', () => {
  expect(lookalikeItems([sum('w:0'), sum('w:2')], face).size).toBe(0);
});
