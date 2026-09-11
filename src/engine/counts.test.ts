import { describe, expect, test } from 'vitest';
import { runSearch, validateRequest } from './search';
import type { SearchRequest } from '../types';

// a=100, b=200, c=300, d=600 (all in one file, no limits)
const cands = [
  { id: 'a', fileId: 'f', value: 100 },
  { id: 'b', fileId: 'f', value: 200 },
  { id: 'c', fileId: 'f', value: 300 },
  { id: 'd', fileId: 'f', value: 600 },
];
const base: SearchRequest = { target: 600, maxCount: null, allowFlips: false, tolerance: 0, candidates: cands, limits: {}, maxResults: 50, timeLimitMs: 5000 };
const found = (req: Partial<SearchRequest>) => {
  const done = runSearch({ ...base, ...req }).find(e => e.type === 'done');
  if (!done || done.type !== 'done') throw new Error('no done event');
  return done.matches.map(m => m.items.map(i => `${i.sign < 0 ? '-' : ''}${i.id}`).join('+'));
};

describe('minCount: sums of exactly / at least N', () => {
  test('without a minimum, the single number and the sums all show', () => {
    expect(found({})).toEqual(['d', 'a+b+c']);
  });
  test('exactly 3 leaves out the single number', () => {
    expect(found({ minCount: 3, maxCount: 3 })).toEqual(['a+b+c']);
  });
  test('exactly 2: nothing here', () => {
    expect(found({ minCount: 2, maxCount: 2 })).toEqual([]);
  });
  test('at least 2, any size', () => {
    expect(found({ minCount: 2, maxCount: null })).toEqual(['a+b+c']);
  });
  test('a range of sizes works with the deeper search too', () => {
    const many = [10, 20, 30, 40, 50].map((v, i) => ({ id: `x${i}`, fileId: 'g', value: v }));
    // 150 = 10+20+30+40+50 (five) = 20+30+40+... only the five-item sum is exactly 5; 150 also = 10+40+50+... (three: 10+40+50? =100 no) — check:
    const out = runSearch({ ...base, candidates: many, target: 150, minCount: 5, maxCount: 5 }).find(e => e.type === 'done');
    expect(out && out.type === 'done' ? out.matches.map(m => m.items.length) : []).toEqual([5]);
  });
  test('validation', () => {
    expect(validateRequest({ ...base, minCount: 0 })).toContain('at least 1');
    expect(validateRequest({ ...base, minCount: 4, maxCount: 3 })).toContain('more than the most');
    expect(validateRequest({ ...base, maxFlips: -1 })).toContain('negative');
    expect(validateRequest({ ...base, minCount: 2, maxCount: 2, maxFlips: 1 })).toBeNull();
  });
});

describe('maxFlips: at most N numbers counted as negative', () => {
  // 400 = a + c = d − b (one flip) = c + b − a (one flip) = d + a − c (one flip)
  test('one flip allowed', () => {
    expect(found({ target: 400, allowFlips: true, maxFlips: 1, maxCount: 3 })).toEqual(['a+c', '-b+d', '-a+b+c', 'a+-c+d']);
  });
  test('two flips needed: only with a higher limit', () => {
    // 200 = a − b − c + d needs two flips
    expect(found({ target: 200, allowFlips: true, maxFlips: 1, maxCount: 4, minCount: 4 })).toEqual([]);
    expect(found({ target: 200, allowFlips: true, maxFlips: 2, maxCount: 4, minCount: 4 })).toEqual(['a+-b+-c+d']);
  });
  test('maxFlips 0 is the same as negatives off', () => {
    expect(found({ target: 400, allowFlips: true, maxFlips: 0, maxCount: 3 })).toEqual(found({ target: 400, allowFlips: false, maxCount: 3 }));
  });
  test('a single number counted as negative is one flip', () => {
    expect(found({ target: -600, allowFlips: true, maxFlips: 1, maxCount: 1 })).toEqual(['-d']);
    expect(found({ target: -600, allowFlips: true, maxFlips: 0, maxCount: 1 })).toEqual([]);
  });
});
