// Small pieces shared by the check table (CheckResults) and its detail in the side pane (SidePane).

import type { ReactNode } from 'react';
import { amountIndex, type CheckRow, type CheckRun } from '../state/store';
import { hoverProps, useLinkClass } from '../state/hover';
import { diffPhrase, formatMoney, locationShort } from '../lib/format';
import type { NearMiss } from '../lib/nearmiss';
import type { Amount, Match } from '../types';

/** Table order: not found first, then sums, then found, then unchecked; document order within each. */
const RANK: Record<CheckRow['status'], number> = { notfound: 0, combo: 1, found: 2, pending: 3 };
export function sortRows(rows: CheckRow[]): CheckRow[] {
  const order = new Map(rows.map((r, i) => [r.amountId, i]));
  return rows.slice().sort((a, b) => RANK[a.status] - RANK[b.status] || order.get(a.amountId)! - order.get(b.amountId)!);
}

/** The row shown when none has been picked: the first in the table once the check is done, else the first checked. */
export function defaultRow(run: CheckRun): CheckRow | undefined {
  return run.status === 'running' ? run.rows[0] : sortRows(run.rows)[0];
}

export function StatusPill({ row, stopped }: { row: CheckRow; stopped?: boolean }) {
  if (row.status === 'pending') return <span className="pill wait">{stopped ? 'Not checked' : 'Checking'}</span>;
  if (row.status === 'notfound') return <span className="pill bad">Not found</span>;
  if (row.status === 'combo') return <span className="pill mixed">Made of {row.matches[0]?.items.length ?? 0}</span>;
  return <span className="pill good">Found</span>;
}

/** A piece of evidence in running text; hovering it links every other place that value appears. */
export function Ev({ amount, children }: { amount: Amount; children: ReactNode }) {
  const link = useLinkClass(amount);
  return <span className={`ev${link}`} {...hoverProps(amount)}>{children}</span>;
}

export function MatchText({ match }: { match: Match }) {
  const idx = amountIndex();
  return (
    <span className="match-text">
      {match.items.map((it, i) => {
        const h = idx.get(it.id);
        if (!h) return null;
        return (
          <span key={it.id}>
            {i > 0 && <span className="op">{it.sign === -1 ? ' − ' : ' + '}</span>}
            {i === 0 && it.sign === -1 && <span className="op">− </span>}
            <Ev amount={h.amount}>
              {h.file.name} · {locationShort(h.amount)}{match.items.length === 1 && h.amount.label ? ` · ${h.amount.label}` : ''} · <span className="num">{formatMoney(h.amount.value, h.amount.decimals)}</span>
            </Ev>
          </span>
        );
      })}
    </span>
  );
}

export function NearText({ near, target, decimals }: { near: NearMiss<Amount>; target: number; decimals: number }) {
  const h = amountIndex().get(near.item.id);
  if (!h) return null;
  return (
    <span className="muted">
      {near.transposed ? <span className="pill typo">Two digits swapped?</span> : 'Close:'}{' '}
      <Ev amount={h.amount}>{h.file.name} · {h.amount.label || locationShort(h.amount)} · {formatMoney(near.value, h.amount.decimals)}</Ev> ({diffPhrase(near.diff, target, decimals)})
    </span>
  );
}
