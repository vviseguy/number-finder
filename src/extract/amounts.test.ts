import { describe, expect, it } from 'vitest';
import { decimalsOf, findAmounts, parseCellAmount } from './amounts';
import { capLabel, cleanLabel, isBoxNumber, joinLabels, splitLeaders, startsWithBoxNumber, withBoxNumber } from './labels';
import { blankPagesWarning, failedPagesWarning } from './warnings';

const texts = (s: string) => findAmounts(s).map((t) => t.text);

describe('findAmounts: what counts', () => {
  it.each([
    // text in, value, decimals, text out
    ['85,000.00', 85000, 2, '85,000.00'],
    ['$3,234.56', 3234.56, 2, '$3,234.56'],
    ['$ 3,234.56', 3234.56, 2, '$3,234.56'],
    ['$\t3,234.56', 3234.56, 2, '$3,234.56'],
    ['(265.44)', -265.44, 2, '(265.44)'],
    ['( 265.44 )', -265.44, 2, '(265.44)'],
    ['($1,234.56)', -1234.56, 2, '($1,234.56)'],
    ['$(1,234.56)', -1234.56, 2, '$(1,234.56)'],
    ['1,234.56-', -1234.56, 2, '1,234.56-'],
    ['-265.44', -265.44, 2, '-265.44'],
    ['−265.44', -265.44, 2, '−265.44'],
    ['-$5.00', -5, 2, '-$5.00'],
    ['3,235', 3235, 0, '3,235'],
    ['410', 410, 0, '410'],
    ['0.00', 0, 2, '0.00'],
    ['1.5', 1.5, 1, '1.5'],
    ['1.2345', 1.2345, 4, '1.2345'],
    ['$25', 25, 0, '$25'],
    ['25.00', 25, 2, '25.00'],
    ['$2025', 2025, 0, '$2025'],
    ['2,025', 2025, 0, '2,025'],
    ['12,345,678.90', 12345678.9, 2, '12,345,678.90'],
    ['12345', 12345, 0, '12345'],
  ])('%s', (input, value, decimals, text) => {
    const tokens = findAmounts(input);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ value, decimals, text });
  });

  it('never returns -0', () => {
    expect(Object.is(findAmounts('(0.00)')[0].value, 0)).toBe(true);
    expect(Object.is(findAmounts('0.00-')[0].value, 0)).toBe(true);
  });

  it('finds several amounts in a line, in order, with positions', () => {
    const line = 'Interest income $ 3,234.56\tpenalty (265.44) net 2,969.12';
    const tokens = findAmounts(line);
    expect(tokens.map((t) => t.value)).toEqual([3234.56, -265.44, 2969.12]);
    expect(line.slice(tokens[0].start, tokens[0].end)).toBe('$ 3,234.56');
    expect(line.slice(tokens[1].start, tokens[1].end)).toBe('(265.44)');
  });

  it('reads through leader dots and around punctuation', () => {
    expect(texts('Wages . . . . . 85,000')).toEqual(['85,000']);
    expect(texts('Wages.......85,000')).toEqual(['85,000']);
    expect(texts('Total is 3,235.')).toEqual(['3,235']);
    expect(texts('3,235, 410; and 2,000')).toEqual(['3,235', '410', '2,000']);
    expect(texts('(see 1,234.56')).toEqual(['1,234.56']);
    expect(texts('amount: 1,234.56*')).toEqual(['1,234.56']);
  });

  it('keeps a subtraction readable: "a - b" makes b negative, not a', () => {
    expect(findAmounts('3,500.00 - 265.44').map((t) => t.value)).toEqual([3500, -265.44]);
  });
});

describe('findAmounts: what does not count', () => {
  it.each([
    ['years', ['2025', '(2025)', 'Tax year 2025', 'issued after 1989', '1900', '2099']],
    ['1–2 digit box and line numbers', ['1', '25', '(1)', '9.', 'Add lines 22 and 23']],
    ['glued to letters', ['2a', '25a', '1z', 'W-2', 'W2', '1099-INT', 'Form1099INT', '10134D', 'Cat. No. 11320B']],
    ['after Form/Schedule/Line/Box/No./#/Page/Copy/OMB', ['Form 1040', 'Form(s) 1099', 'Schedule 8812', 'Line 125', 'Box 500', 'PO Box 500', 'No. 12345', '#12345', 'Page 100', 'Copy 123', 'OMB 1545', 'Sec. 1250', 'Suite 400']],
    ['SSN, EIN, masked TIN', ['000-00-0000', '123-45-6789', '12-3456789', 'XXX-XX-1234', '***-**-1234']],
    ['phone numbers', ['(555) 123-4567', '555-123-4567', '555.123.4567', '555 123 4567', '+1 (555) 123-4567']],
    ['ZIP codes', ['Anytown, IL 12345', 'Anytown IL 12345', '12345-6789']],
    ['street numbers', ['200 Oak Avenue', '100 Lakeside Drive', '1600 N Main St']],
    ['dates', ['1/31/2026', '12/31/2025', '2025-12-31', 'Jan 31, 2026', 'January 31, 2026', '31 Jan 2026', 'Dec. 31, 2025', 'Jan. 1–Dec. 31, 2025']],
    ['percentages', ['22%', '22 %', '12.5%', '(3.25%)']],
    ['account numbers (9+ plain digits)', ['123456789', '0012345678', '$123456789']],
    ['OMB numbers and ranges', ['OMB No. 1545-0074', '1545-0112', '2023-2025', 'Pages 3-4']],
    ['malformed numbers', ['1,2,3', '31,2026', '1.23456', '1.2.3', '12,34.56']],
  ])('%s', (_name, inputs) => {
    for (const input of inputs) expect(texts(input), input).toEqual([]);
  });

  it('whole form headers produce nothing', () => {
    expect(texts('Form W-2 Wage and Tax Statement 2025')).toEqual([]);
    expect(texts('Form 1040 U.S. Individual Income Tax Return 2025 OMB No. 1545-0074')).toEqual([]);
    expect(texts('Total income. Add lines 1z, 2b, 3b, 4b, 5b, 6b, 7, and 8')).toEqual([]);
    expect(texts('Anytown\tIL\t12345')).toEqual([]);
  });
});

describe('parseCellAmount (spreadsheet cells)', () => {
  it.each([
    ['$1,234.56', 1234.56, 2],
    ['(75.00)', -75, 2],
    ['125', 125, 0],
    ['2000', 2000, 0],
    ['25', 25, 0],
    ['  $250.00 ', 250, 2],
    ['1,234.56-', -1234.56, 2],
  ])('%s is an amount', (input, value, decimals) => {
    expect(parseCellAmount(input)).toMatchObject({ value, decimals });
  });

  it.each(['2025-01-15', '3/2/2025', 'Jan 31, 2026', 'Red Cross', 'Total 1,234.56', '22%', '000-00-0000', '12-3456789', '12345-6789', '123456789', '(555) 123-4567', '2a', ''])(
    '%j is not',
    (input) => {
      expect(parseCellAmount(input)).toBeNull();
    },
  );
});

describe('decimalsOf', () => {
  it('counts shown decimals', () => {
    expect(decimalsOf('3,500.00')).toBe(2);
    expect(decimalsOf('2000')).toBe(0);
    expect(decimalsOf('(1,234.5)')).toBe(1);
    expect(decimalsOf('$0.1234')).toBe(4);
  });
});

describe('label helpers', () => {
  it('recognizes bare box and line numbers', () => {
    for (const s of ['1', '1a', '25d', '(3)', 'Line 9', 'Box 12', '2b.']) expect(isBoxNumber(s), s).toBe(true);
    for (const s of ['Wages', '1 Wages', '123', 'a']) expect(isBoxNumber(s), s).toBe(false);
    expect(startsWithBoxNumber('25a Federal income tax withheld')).toBe(true);
    expect(startsWithBoxNumber('Wages 25')).toBe(false);
  });

  it('splits leader dots and the line number printed after them', () => {
    expect(splitLeaders('b Taxable interest . . . . . 2b')).toEqual({ text: 'b Taxable interest', box: '2b', leaders: true });
    expect(splitLeaders('Wages.........')).toEqual({ text: 'Wages', box: '', leaders: true });
    expect(splitLeaders('Enter amount from line 9')).toEqual({ text: 'Enter amount from line 9', box: '', leaders: false });
    expect(splitLeaders('Interest on U.S. Savings Bonds').leaders).toBe(false);
  });

  it('cleans and caps labels', () => {
    expect(cleanLabel('  1   Interest income:  ')).toBe('1 Interest income');
    expect(cleanLabel('Wages . . . . . more')).toBe('Wages more');
    const long = 'Subtract line 3 from line 2. Enter the result here and on Form 1040, line 2b, and then some more words';
    const capped = capLabel(long);
    expect(capped.length).toBeLessThanOrEqual(71);
    expect(capped.endsWith('…')).toBe(true);
    expect(long.startsWith(capped.slice(0, -1))).toBe(true);
    expect(long[capped.length - 1]).toMatch(/[\s,]/); // cut on a word boundary
    expect(capLabel('short')).toBe('short');
  });

  it('puts the box number in front of a label that lacks one', () => {
    expect(withBoxNumber('b Taxable interest', '2b')).toBe('2b Taxable interest');
    expect(withBoxNumber('Wages, salaries, tips', '1a')).toBe('1a Wages, salaries, tips');
    expect(withBoxNumber('1a Wages', '1a')).toBe('1a Wages');
    expect(withBoxNumber('Gross interest', '')).toBe('Gross interest');
    expect(withBoxNumber('', 'Line 7')).toBe('7');
  });

  it('joins spreadsheet row label and header', () => {
    expect(joinLabels('Schwab', 'Amount')).toBe('Schwab · Amount');
    expect(joinLabels('Gross interest', '')).toBe('Gross interest');
    expect(joinLabels('', 'Amount')).toBe('Amount');
    expect(joinLabels('Amount', 'amount')).toBe('Amount');
  });
});

describe('warnings', () => {
  it('names blank and failed pages', () => {
    expect(blankPagesWarning([3, 4])).toBe('Pages 3–4 have no readable text (scanned?)');
    expect(blankPagesWarning([2])).toBe('Page 2 has no readable text (scanned?)');
    expect(blankPagesWarning([4, 1, 3])).toBe('Pages 1, 3–4 have no readable text (scanned?)');
    expect(failedPagesWarning([5])).toBe("Couldn't read page 5.");
  });
});
