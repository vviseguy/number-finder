import { describe, expect, test } from 'vitest';
import { findNearMiss, isTransposition } from './nearmiss';

describe('isTransposition', () => {
  test('two adjacent digits swapped', () => {
    expect(isTransposition(9120, 9102, 0)).toBe(true);
    expect(isTransposition(3253, 3234.56, 0)).toBe(true); // compared in whole dollars: 3253 vs 3235
    expect(isTransposition(1234.56, 1243.56, 2)).toBe(true);
  });
  test('not a transposition', () => {
    expect(isTransposition(9120, 9120, 0)).toBe(false);
    expect(isTransposition(9120, 9021, 0)).toBe(false); // two separate changes
    expect(isTransposition(9120, 1920, 0)).toBe(true); // adjacent at the front still counts
    expect(isTransposition(9120, 2910, 0)).toBe(false); // not adjacent
    expect(isTransposition(410, 350, 0)).toBe(false);
    expect(isTransposition(9120, -9102, 0)).toBe(false); // sign differs
  });
});

describe('findNearMiss', () => {
  const values = [85000, 9102, 5270, 350, 3234.56, 2000];
  const near = (target: number, decimals = 0, flips = false) => findNearMiss(target, decimals, values, v => v, flips);

  test('a transposition wins over a closer plain number', () => {
    const r = findNearMiss(9120, 0, [9119, 9102], v => v);
    expect(r?.value).toBe(9102);
    expect(r?.transposed).toBe(true);
  });
  test('the classic cases', () => {
    expect(near(9120)).toMatchObject({ value: 9102, diff: -18, transposed: true });
    expect(near(3253)).toMatchObject({ value: 3234.56, transposed: true });
  });
  test('within 2% is close; farther is nothing', () => {
    expect(near(2030)).toMatchObject({ value: 2000, transposed: false });
    expect(near(410)).toBeNull();
    expect(near(11874)).toBeNull();
  });
  test('exact matches are not near misses', () => expect(near(2000)).toBeNull());
  test('flips only when allowed', () => {
    expect(near(-2010)).toBeNull();
    expect(near(-2010, 0, true)).toMatchObject({ value: -2000, sign: -1 });
  });
});
