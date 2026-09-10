import { amountIndex, fileLabel } from '../state/store';
import { locationShort } from '../lib/format';
import type { Match } from '../types';
import { Ev } from './checkParts';
import { Money } from './Money';

/**
 * A sum on one line: "W-2 85,000.00 + INT 3,234.56 −(265.44) = 88,000.00".
 * Each piece is hoverable (linking the same value elsewhere) and carries the full location in a tooltip.
 */
export function Equation({ match, withFiles = true }: { match: Match; withFiles?: boolean }) {
  const idx = amountIndex();
  return (
    <span className="equation">
      {match.items.map((it, i) => {
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
              </span>
            </Ev>
          </span>
        );
      })}
      <span className="op"> = </span>
      <Money value={match.sum} />
    </span>
  );
}
