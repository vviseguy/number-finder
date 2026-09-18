import { amountIndex, fileLabel } from '../state/store';
import { locationShort, plural } from '../lib/format';
import type { Match } from '../types';
import { Ev } from './checkParts';
import { Money } from './Money';

/**
 * A sum on one line: "W-2 85,000.00 + INT 3,234.56 −(265.44) = 88,000.00".
 * Each piece is hoverable (linking the same value elsewhere) and carries the full location in a tooltip.
 * layout 'row' puts the terms and the total side by side, trimming the terms to … when they overflow
 * so the total is always visible. `distinguish` adds a word to the numbers that need one — when another
 * match holds the same value from somewhere else, and the two would otherwise read the same (lib/lookalike.ts).
 */
export function Equation({ match, withFiles = true, layout = 'inline', distinguish }: {
  match: Match; withFiles?: boolean; layout?: 'inline' | 'row'; distinguish?: Map<string, string>;
}) {
  const idx = amountIndex();
  const terms = match.items.map((it, i) => {
    const h = idx.get(it.id);
    if (!h) return null;
    const neg = it.sign === -1;
    const title = `${h.file.name} · ${locationShort(h.amount)}${h.amount.label ? ` · ${h.amount.label}` : ''}`;
    return (
      <span key={it.id} className="term">
        {i > 0 && <span className="op">{neg ? ' ' : ' + '}</span>}
        <Ev amount={h.amount}>
          <span title={title}>
            {withFiles && <span className="term-file">{fileLabel(h.file)} </span>}
            <Money value={h.amount.value} decimals={h.amount.decimals} flipped={neg} />
            {distinguish?.get(it.id) && <span className="term-which"> {distinguish.get(it.id)}</span>}
          </span>
        </Ev>
      </span>
    );
  });
  const total = <span className="eq-total"><span className="op"> = </span><Money value={match.sum} /></span>;
  if (layout === 'row') {
    return <span className="equation row"><span className="eq-terms">{terms}</span>{total}</span>;
  }
  return <span className="equation">{terms}{total}</span>;
}

/** "Sum of 3 amounts across W-2.pdf, 1099-INT.pdf and 1 other file · 1 counted as negative" */
export function sumTitle(match: Match): string {
  const idx = amountIndex();
  const files: string[] = [];
  for (const it of match.items) {
    const h = idx.get(it.id);
    if (h && !files.includes(fileLabel(h.file))) files.push(fileLabel(h.file));
  }
  const flipped = match.items.filter(it => it.sign === -1).length;
  let where: string;
  if (files.length <= 1) where = `in ${files[0] ?? 'a file'}`;
  else if (files.length === 2) where = `across ${files[0]} and ${files[1]}`;
  else where = `across ${files[0]}, ${files[1]} and ${plural(files.length - 2, 'other file')}`;
  return `Sum of ${match.items.length} amounts ${where}${flipped ? ` · ${flipped} counted as negative` : ''}`;
}
