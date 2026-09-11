import { describe, expect, test } from 'vitest';
import { decimalsOf, describeLimit, diffPhrase, formatMoney, locationShort, parseAmountInput, parseLimit } from './format';
import type { Amount } from '../types';

describe('parseAmountInput', () => {
  test.each([
    ['3,235', 3235],
    ['$3,234.56', 3234.56],
    ['(75.00)', -75],
    ['75.00-', -75],
    ['-265.44', -265.44],
    [' 1 234.5 ', 1234.5],
    ['.5', 0.5],
  ])('%s → %d', (text, value) => expect(parseAmountInput(text)).toBe(value));

  test.each(['', 'abc', '1.2.3', '--5', '()'])('rejects %j', text => expect(parseAmountInput(text)).toBeNull());
});

test('decimalsOf', () => {
  expect(decimalsOf('3,235')).toBe(0);
  expect(decimalsOf('3,234.56')).toBe(2);
});

describe('parseLimit (per-file limit in a group)', () => {
  test('blank and any mean no limit', () => {
    expect(parseLimit('')).toEqual({ min: 0, max: null });
    expect(parseLimit('any')).toEqual({ min: 0, max: null });
  });
  test('a single number is a maximum, not an exact count', () => expect(parseLimit('1')).toEqual({ min: 0, max: 1 }));
  test('ranges and minimums', () => {
    expect(parseLimit('1-2')).toEqual({ min: 1, max: 2 });
    expect(parseLimit('0 to 3')).toEqual({ min: 0, max: 3 });
    expect(parseLimit('2+')).toEqual({ min: 2, max: null });
  });
  test('rejects nonsense', () => {
    expect(parseLimit('3-1')).toBeNull();
    expect(parseLimit('lots')).toBeNull();
  });
  test('describeLimit reads naturally', () => {
    expect(describeLimit('')).toBe('any');
    expect(describeLimit('1')).toBe('max 1');
    expect(describeLimit('1-2')).toBe('1–2');
    expect(describeLimit('2+')).toBe('at least 2');
    expect(describeLimit('x')).toBe('invalid');
  });
});

test('madeOf and negatives labels cover exactly, between, at least, and a cap on negatives', async () => {
  const { madeOfLabel, madeOfPhrase, negativesLabel } = await import('./format');
  expect(madeOfLabel(3)).toBe('sums of up to 3');
  expect(madeOfLabel(3, 3)).toBe('sums of exactly 3');
  expect(madeOfLabel(4, 2)).toBe('sums of 2 to 4');
  expect(madeOfLabel(null, 2)).toBe('sums of 2 or more');
  expect(madeOfLabel(null)).toBe('any sum');
  expect(madeOfPhrase(3, 3)).toBe('as a sum of exactly 3 numbers');
  expect(madeOfPhrase(null, 2)).toBe('as a sum of 2 or more numbers');
  expect(negativesLabel(false, 1)).toBe('');
  expect(negativesLabel(true)).toBe('negatives');
  expect(negativesLabel(true, 1)).toBe('up to 1 negative');
  expect(negativesLabel(true, 2)).toBe('up to 2 negatives');
});

test('time limits read naturally and step up', async () => {
  const { secondsLabel, longerSeconds, elapsedLabel } = await import('./format');
  expect(secondsLabel(45)).toBe('45 s');
  expect(secondsLabel(120)).toBe('2 min');
  expect(secondsLabel(90)).toBe('1 min 30 s');
  expect(secondsLabel(3600)).toBe('1 h');
  expect(secondsLabel(null)).toBe('no limit');
  expect(longerSeconds(1)).toBe(10);
  expect(longerSeconds(30)).toBe(120);
  expect(longerSeconds(600)).toBeNull();
  expect(longerSeconds(null)).toBeUndefined();
  expect(elapsedLabel(400)).toBe('0.4 s');
  expect(elapsedLabel(8_400)).toBe('8.4 s');
  expect(elapsedLabel(42_900)).toBe('42 s');
  expect(elapsedLabel(65_000)).toBe('1 min 05 s');
});

test('locationLong reads well as a heading', async () => {
  const { locationLong } = await import('./format');
  const at = (location: Amount['location']) => ({ id: 'f:0', fileId: 'f', value: 1, text: '1', label: '', decimals: 0, location }) as Amount;
  expect(locationLong(at({ kind: 'pdf', page: 2, box: [0, 0, 1, 1] }), 3)).toBe('Page 2 of 3');
  expect(locationLong(at({ kind: 'pdf', page: 1, box: [0, 0, 1, 1] }), 1)).toBe('Page 1');
  expect(locationLong(at({ kind: 'sheet', sheet: 'Interest', cell: 'D9' }))).toBe('Sheet Interest · cell D9');
  expect(locationLong(at({ kind: 'sheet', sheet: 'CSV', cell: 'B5' }))).toBe('Row 5');
});

test('formatMoney uses a true minus and respects whole dollars', () => {
  expect(formatMoney(3234.56)).toBe('3,234.56');
  expect(formatMoney(3235, 0)).toBe('3,235');
  expect(formatMoney(-265.44)).toBe('−265.44');
  expect(formatMoney(0.1 + 0.2)).toBe('0.30');
});

test('diffPhrase explains how far off the nearest number is', () => {
  expect(diffPhrase(-18, 9120, 0)).toBe('18.00 less than 9,120');
  expect(diffPhrase(0.001, 5, 0)).toBe('same as 5');
});

test('locationShort', () => {
  const base = { id: 'f:0', fileId: 'f', value: 1, text: '1', label: '', decimals: 0 };
  expect(locationShort({ ...base, location: { kind: 'pdf', page: 2, box: [0, 0, 1, 1] } } as Amount)).toBe('page 2');
  expect(locationShort({ ...base, location: { kind: 'sheet', sheet: 'Interest', cell: 'D9' } } as Amount)).toBe('Interest!D9');
  expect(locationShort({ ...base, location: { kind: 'sheet', sheet: 'CSV', cell: 'C5' } } as Amount)).toBe('row 5');
});
