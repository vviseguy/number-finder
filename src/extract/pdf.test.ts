// Page layout rules on synthetic pdf.js text items (no PDF needed).
import { describe, expect, it } from 'vitest';
import { amountsOnPage, type RawTextItem } from './pdf';

/** A horizontal text item; width defaults to Courier-like 0.6 em per character. */
function item(str: string, x: number, y: number, size = 10, width = size * 0.6 * str.length): RawTextItem {
  return { str, transform: [size, 0, 0, size, x, y], width, height: size, fontName: 'f' };
}

const page = (items: RawTextItem[]) => amountsOnPage(items, { f: { ascent: 0.8, descent: -0.2 } }, 612);
const summary = (items: RawTextItem[]) => page(items).amounts.map((a) => [a.token.text, a.label]);

describe('amountsOnPage', () => {
  it('merges "$", "3,234", ".56" split across items and boxes the union', () => {
    const { amounts } = page([
      item('1 Interest income', 40, 700, 9),
      item('$', 300, 700, 10, 5.56),
      item('3,234', 306, 700, 10, 30),
      item('.56', 336, 700, 10, 18),
    ]);
    expect(amounts).toHaveLength(1);
    const [a] = amounts;
    expect(a.token).toMatchObject({ value: 3234.56, text: '$3,234.56', decimals: 2 });
    expect(a.label).toBe('1 Interest income');
    const [x, y, w, h] = a.box;
    expect(x).toBeCloseTo(300, 1);
    expect(w).toBeCloseTo(54, 1);
    expect(y).toBeCloseTo(698, 1); // baseline 700 + descent -0.2 em
    expect(h).toBeCloseTo(10, 1);
  });

  it('uses the caption above for box-style forms (W-2), not text from the next column', () => {
    expect(
      summary([
        item('1  Wages, tips, other compensation', 310, 713, 6.5, 110),
        item('2  Federal income tax withheld', 445, 713, 6.5, 95),
        item('Acme Widget Co.', 40, 698),
        item('85,000.00', 310, 698),
        item('9,102.00', 445, 698),
      ]),
    ).toEqual([
      ['85,000.00', '1 Wages, tips, other compensation'],
      ['9,102.00', '2 Federal income tax withheld'],
    ]);
  });

  it('joins a caption that wraps onto two lines', () => {
    expect(
      summary([
        item('1  Wages, tips, other', 310, 721, 6.5, 70),
        item('compensation', 310, 713, 6.5, 45),
        item('85,000.00', 310, 698),
      ]),
    ).toEqual([['85,000.00', '1 Wages, tips, other compensation']]);
  });

  it('reads 1040-style lines: label, leader dots, line number, value', () => {
    expect(
      summary([
        item('2a', 36, 580, 8, 9),
        item('Tax-exempt interest . . . . . . . . .', 52, 580, 8, 160),
        item('2a', 225, 580, 8, 9),
        item('410', 282, 580),
        item('b', 310, 580, 8, 4.5),
        item('Taxable interest . . . . . . . . . . . . .', 318, 580, 8, 126),
        item('2b', 452, 580, 8, 9),
        item('3,235', 540, 580),
      ]),
    ).toEqual([
      ['410', '2a Tax-exempt interest'],
      ['3,235', '2b Taxable interest'],
    ]);
  });

  it('prefers row text over a column header above a column of amounts', () => {
    expect(
      summary([
        item('Amount', 500, 716, 9),
        item('Schwab', 60, 700),
        item('2,000.00', 500, 700),
        item('Vanguard', 60, 686),
        item('100.00', 500, 686),
      ]),
    ).toEqual([
      ['2,000.00', 'Schwab'],
      ['100.00', 'Vanguard'],
    ]);
  });

  it('falls back to a column header when there is nothing else', () => {
    expect(summary([item('Amount', 500, 716, 9), item('2,000.00', 500, 700)])).toEqual([['2,000.00', 'Amount']]);
  });

  it('keeps a lone box number as the label when no text is near', () => {
    expect(summary([item('7', 400, 500, 8, 5), item('1,234', 540, 500)])).toEqual([['1,234', '7']]);
  });

  it('drops simulated bold (the same text drawn twice a hair apart)', () => {
    const { amounts } = page([item('85,000.00', 310, 698), item('85,000.00', 310.3, 698)]);
    expect(amounts.map((a) => a.token.value)).toEqual([85000]);
  });

  it('orders amounts top to bottom, then left to right', () => {
    const { amounts } = page([item('4,000', 400, 600), item('3,000', 100, 600), item('2,000', 400, 700), item('1,000', 100, 700)]);
    expect(amounts.map((a) => a.token.value)).toEqual([1000, 2000, 3000, 4000]);
  });

  it('does not join separate numbers that are a word-space apart', () => {
    const { amounts } = page([item('100', 100, 700), item('200', 100 + 18 + 3, 700)]);
    expect(amounts.map((a) => a.token.value)).toEqual([100, 200]);
  });

  it('handles rotated text with a rotated box', () => {
    const rotated: RawTextItem = { str: '1,234.56', transform: [0, 10, -10, 0, 50, 300], width: 48, height: 10, fontName: 'f' };
    const { amounts } = page([rotated]);
    expect(amounts).toHaveLength(1);
    const [x, y, w, h] = amounts[0].box;
    expect(h).toBeCloseTo(48, 1);
    expect(w).toBeCloseTo(10, 1);
    expect(y).toBeCloseTo(300, 1);
    expect(x).toBeCloseTo(42, 1);
  });

  it('reports pages without text', () => {
    expect(page([]).hasText).toBe(false);
    expect(page([item('   ', 10, 10)]).hasText).toBe(false);
    expect(page([item('Hello', 10, 10)])).toEqual({ amounts: [], hasText: true });
  });
});
