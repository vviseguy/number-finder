import { describe, expect, test } from 'vitest';
import { isSetupText, parseSetup, serializeSetup, type SavedSetup } from './setupfile';

const setup: SavedSetup = {
  groups: [{ id: 'g1', name: 'Source docs', color: 0, members: [{ key: 'W-2.pdf|1234', name: 'W-2.pdf', limit: '1' }] }],
  nicks: { 'W-2.pdf|1234': 'W2' },
  find: { groupId: 'g1', maxCount: 3, rounding: 'dollar', allowFlips: false },
  resultSort: 'closest',
  runs: [{ kind: 'search', target: 3235, targetDecimals: 0, range: null, settings: { groupId: 'g1', maxCount: 1, rounding: 'dollar', allowFlips: false }, terms: { include: [], exclude: ['hours'], fuzzy: [], prefer: [] } }],
  folder: 'Tax 2025',
};

describe('setup files', () => {
  test('round-trip', () => {
    const text = serializeSetup(setup);
    expect(isSetupText(text)).toBe(true);
    const back = parseSetup(text);
    expect(back.setup).toEqual(setup);
    expect(back.savedAt).toMatch(/^\d{4}-/);
  });
  test('rejects other files with a plain message', () => {
    expect(() => parseSetup('not json')).toThrow("isn't a Number finder setup file");
    expect(() => parseSetup('{"hello":1}')).toThrow("isn't a Number finder setup file");
    expect(() => parseSetup('{"app":"number-finder","version":9,"setup":{}}')).toThrow('version 9');
    expect(isSetupText('{"hello":1}')).toBe(false);
  });
  test('fills in what is missing', () => {
    const { setup: s } = parseSetup('{"app":"number-finder","version":1,"setup":{"groups":[{"id":"g","name":"G"}],"runs":[{"kind":"nope"}]}}');
    expect(s.groups).toEqual([{ id: 'g', name: 'G', members: [] }]);
    expect(s.runs).toEqual([]);
    expect(s.nicks).toEqual({});
    expect(s.find.rounding).toBe('dollar');
  });
});
