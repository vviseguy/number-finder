import { describe, expect, test } from 'vitest';
import { coincidencePhrase, durationPhrase, estimateSearch, type SizeInput } from './estimate';

function rand(seed: number) { return () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; }; }
const amounts = (n: number, seed = 1) => { const r = rand(seed); return Array.from({ length: n }, () => Math.round(r() * 2_000_000) / 100); };
const base = (values: number[], over: Partial<SizeInput> = {}): SizeInput => ({ values, target: null, maxCount: 3, allowFlips: false, tolerance: 0.5, ...over });

describe('estimateSearch', () => {
  test('a small search is quick and has no coincidences to speak of', () => {
    const e = estimateSearch(base(amounts(12), { target: 12_345.67, maxCount: 2, tolerance: 0 }));
    expect(e.numbers).toBe(12);
    expect(e.seconds).toBeLessThan(0.01);
    expect(e.coincidences!).toBeLessThan(0.1);
    expect(e.log10Combos).toBeCloseTo(Math.log10(12 + 66), 5); // 12 singles + 66 pairs
  });
  test('any count over many numbers is far too big, and full of coincidences', () => {
    const e = estimateSearch(base(amounts(60), { target: 100_000, maxCount: null }));
    expect(e.seconds).toBeGreaterThan(1e6);
    expect(e.coincidences!).toBeGreaterThan(1000);
  });
  test('negatives make it bigger; capping them makes it smaller again', () => {
    const v = amounts(80);
    const plain = estimateSearch(base(v, { maxCount: 5 }));
    const neg = estimateSearch(base(v, { maxCount: 5, allowFlips: true }));
    const one = estimateSearch(base(v, { maxCount: 5, allowFlips: true, maxFlips: 1 }));
    expect(neg.seconds).toBeGreaterThan(plain.seconds * 10);
    expect(one.log10Combos).toBeLessThan(neg.log10Combos);
    expect(one.log10Combos).toBeGreaterThan(plain.log10Combos);
    expect(estimateSearch(base(v, { maxCount: 5, allowFlips: true, maxFlips: 0 }))).toEqual(plain);
  });
  test('"exactly 3" has fewer sums than "up to 3"', () => {
    const v = amounts(40);
    expect(estimateSearch(base(v, { maxCount: 3, minCount: 3 })).log10Combos).toBeLessThan(estimateSearch(base(v, { maxCount: 3 })).log10Combos);
  });
  test('zeros are left out, and an empty search is empty', () => {
    expect(estimateSearch(base([0, 0, 5, 7])).numbers).toBe(2);
    expect(estimateSearch(base([], { target: 5 }))).toMatchObject({ numbers: 0, seconds: 0, coincidences: 0 });
  });
  test('a target far from any typical sum has fewer coincidences than one in the thick of them', () => {
    const v = amounts(40);
    const typical = estimateSearch(base(v, { target: 30_000, maxCount: 4 })).coincidences!;
    const far = estimateSearch(base(v, { target: 5_000_000, maxCount: 4 })).coincidences!;
    expect(far).toBeLessThan(typical / 1000);
  });
});

test('phrases', () => {
  expect(durationPhrase(0.2)).toBe('under a second');
  expect(durationPhrase(40)).toBe('about 40 seconds');
  expect(durationPhrase(600)).toBe('about 10 minutes');
  expect(durationPhrase(3 * 3600)).toBe('about 3 hours');
  expect(durationPhrase(12 * 86400)).toBe('about 12 days');
  expect(durationPhrase(Infinity)).toBe('longer than a lifetime');
  expect(coincidencePhrase(1.2, '3,235')).toBe('a sum or two may add up to 3,235 by coincidence');
  expect(coincidencePhrase(12, '3,235')).toBe('expect several sums to add up to 3,235 by coincidence');
  expect(coincidencePhrase(1e9, '3,235')).toContain('so a match alone proves little');
});
