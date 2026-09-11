import { describe, expect, test } from 'vitest';
import { parseQuery, passesTerms, serializeTerms, termsPhrase, termsSentence } from './query';
import type { Amount } from '../types';

const nums = (t: string) => parseQuery(t).numbers.map(n => n.value);

describe('parseQuery', () => {
  test('a plain number', () => {
    expect(parseQuery('3,235').numbers).toEqual([{ value: 3235, decimals: 0, text: '3,235' }]);
    expect(parseQuery('$3,234.56').numbers[0]).toMatchObject({ value: 3234.56, decimals: 2 });
  });
  test('several numbers', () => expect(nums('3,235 85,000 2,000')).toEqual([3235, 85000, 2000]));
  test('negative numbers are numbers, not filters', () => {
    expect(parseQuery('-265.44')).toMatchObject({ numbers: [{ value: -265.44 }], terms: { exclude: [] } });
    expect(nums('(75.00)')).toEqual([-75]);
  });
  test('-word skips, word keeps only, in any order', () => {
    expect(parseQuery('3,235 -hours').terms).toEqual({ include: [], exclude: ['hours'] });
    expect(parseQuery('-hours 3,235 interest').terms).toEqual({ include: ['interest'], exclude: ['hours'] });
    expect(parseQuery('+Interest 5').terms.include).toEqual(['interest']);
  });
  test('quotes keep phrases together', () => {
    expect(parseQuery('2,080 -"hourly rate" "gross pay"').terms).toEqual({ include: ['gross pay'], exclude: ['hourly rate'] });
  });
  test('form names are words, not numbers', () => {
    expect(parseQuery('85,000 W-2')).toMatchObject({ numbers: [{ value: 85000 }], terms: { include: ['w-2'] } });
    expect(parseQuery('85,000 -w-2').terms.exclude).toEqual(['w-2']);
  });
  test('a range', () => {
    expect(parseQuery('3,200..3,300').range).toEqual({ lo: 3200, hi: 3300, text: '3,200..3,300' });
    expect(parseQuery('3,300..3,200').range).toMatchObject({ lo: 3200, hi: 3300 });
    expect(parseQuery('a..b').errors[0]).toContain("isn't a range");
  });
  test('in: picks a group, with quotes for spaces', () => {
    expect(parseQuery('3,235 in:Source').inGroup).toBe('Source');
    expect(parseQuery('3,235 in:"Source docs"').inGroup).toBe('Source docs');
  });
  test('sums:, tolerance, and negatives', () => {
    expect(parseQuery('3,235 sums:3').maxCount).toBe(3);
    expect(parseQuery('3,235 sums:any').maxCount).toBeNull();
    expect(parseQuery('3,235 sum:1').maxCount).toBe(1);
    expect(parseQuery('3,235 sums:lots').errors[0]).toContain('sums:3');
    expect(parseQuery('3,235 ±0.50').tolerance).toBe(0.5);
    expect(parseQuery('3,235 ~1').tolerance).toBe(1);
    expect(parseQuery('3,235 neg').negatives).toBe(true);
    expect(parseQuery('3,235 negatives:off').negatives).toBe(false);
    expect(parseQuery('3,235').maxCount).toBeUndefined();
  });
});

test('passesTerms looks at the label, sheet, and file text', () => {
  const a = { id: 'f:1', fileId: 'f', value: 2080, text: '2080', label: 'Pat Sample · Hours', decimals: 0, location: { kind: 'sheet', sheet: 'Payroll', cell: 'B2' } } as Amount;
  expect(passesTerms(a, 'payroll.xlsx', parseQuery('-hours').terms)).toBe(false);
  expect(passesTerms(a, 'payroll.xlsx', parseQuery('-rate').terms)).toBe(true);
  expect(passesTerms(a, 'payroll.xlsx', parseQuery('payroll').terms)).toBe(true);
  expect(passesTerms(a, 'payroll.xlsx', parseQuery('interest').terms)).toBe(false);
});

test('describing and re-serializing filters', () => {
  const t = parseQuery('interest -hours -"hourly rate"').terms;
  expect(termsPhrase(t)).toBe('skipping “hours”, “hourly rate” · only “interest”');
  expect(termsSentence(t)).toBe('Only numbers that mention “interest”, skipping numbers that mention “hours”, “hourly rate”.');
  expect(serializeTerms(t)).toBe('interest -hours -"hourly rate"');
  expect(termsPhrase(parseQuery('3,235').terms)).toBe('');
});
