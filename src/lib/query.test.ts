import { describe, expect, test } from 'vitest';
import { parseQuery, passesTerms, serializeTerms, termsPhrase, termsSentence } from './query';
import type { Amount } from '../types';

describe('parseQuery', () => {
  test('a plain number', () => {
    expect(parseQuery('3,235')).toMatchObject({ value: 3235, decimals: 0, terms: { include: [], exclude: [] } });
    expect(parseQuery('$3,234.56')).toMatchObject({ value: 3234.56, decimals: 2 });
  });
  test('negative numbers are numbers, not filters', () => {
    expect(parseQuery('-265.44')).toMatchObject({ value: -265.44, terms: { exclude: [] } });
    expect(parseQuery('(75.00)').value).toBe(-75);
  });
  test('-word skips, word keeps only, in any order', () => {
    expect(parseQuery('3,235 -hours')).toMatchObject({ value: 3235, terms: { include: [], exclude: ['hours'] } });
    expect(parseQuery('-hours 3,235 interest')).toMatchObject({ value: 3235, terms: { include: ['interest'], exclude: ['hours'] } });
    expect(parseQuery('+Interest 5').terms.include).toEqual(['interest']);
  });
  test('quotes keep phrases together', () => {
    expect(parseQuery('2,080 -"hourly rate" "gross pay"').terms).toEqual({ include: ['gross pay'], exclude: ['hourly rate'] });
  });
  test('form names are words, not numbers', () => {
    expect(parseQuery('85,000 W-2')).toMatchObject({ value: 85000, terms: { include: ['w-2'] } });
    expect(parseQuery('85,000 -w-2').terms.exclude).toEqual(['w-2']);
  });
  test('filters alone, and extra numbers are reported', () => {
    expect(parseQuery('-hours')).toMatchObject({ value: null, terms: { exclude: ['hours'] } });
    expect(parseQuery('3,235 9,120').extraNumbers).toEqual(['9,120']);
  });
});

test('passesTerms looks at the label, sheet, and file name', () => {
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
