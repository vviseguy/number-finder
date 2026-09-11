import { describe, expect, test } from 'vitest';
import { allowedEdits, fuzzyIncludes, squash, substringDistance } from './fuzzy';

describe('substringDistance', () => {
  test('exact substring is 0', () => expect(substringDistance('interest', 'box 1 interest income')).toBe(0));
  test('one typo is 1', () => expect(substringDistance('intrest', 'interest income')).toBe(1));
  test('a missing and an extra letter are 2', () => expect(substringDistance('intrst', 'interest')).toBe(2));
  test('nothing alike is far', () => expect(substringDistance('hours', 'interest')).toBeGreaterThan(2));
  test('empty pattern matches', () => expect(substringDistance('', 'x')).toBe(0));
});

describe('fuzzyIncludes', () => {
  test('is case-insensitive and ignores punctuation', () => {
    expect(fuzzyIncludes('Form 1099-INT · Interest income', '1099int')).toBe(true);
    expect(fuzzyIncludes('W-2.pdf', 'w2')).toBe(true);
  });
  test('allows one typo from 4 letters, two from 8', () => {
    expect(allowedEdits(3)).toBe(0);
    expect(allowedEdits(4)).toBe(1);
    expect(allowedEdits(8)).toBe(2);
    expect(fuzzyIncludes('Interest income', 'intrest')).toBe(true);
    expect(fuzzyIncludes('Interest income', 'intrst')).toBe(false); // 6 letters: only one edit allowed
    expect(fuzzyIncludes('Dividends', 'divdend')).toBe(true);
    expect(fuzzyIncludes('Hours', 'rate')).toBe(false);
  });
  test('short words must match exactly', () => {
    expect(fuzzyIncludes('Box 1 wages', 'box')).toBe(true);
    expect(fuzzyIncludes('Box 1 wages', 'bax')).toBe(false);
  });
  test('squash keeps letters and digits from any script', () => expect(squash('Été 2025 — W-2')).toBe('été2025w2'));
});
