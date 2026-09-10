// Small pieces shared by the check table (CheckResults) and its detail in the side pane (SidePane).

import type { ReactNode } from 'react';
import { amountIndex, fileLabel, type CheckRow, type CheckRun } from '../state/store';
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

/** A single found number, in full: "INT · page 1 · 1 Interest income · 3,234.56". */
export function SingleText({ match }: { match: Match }) {
  const it = match.items[0];
  const h = amountIndex().get(it.id);
  if (!h) return null;
  return (
    <Ev amount={h.amount}>
      {h.file.name !== fileLabel(h.file) ? <span title={h.file.name}>{fileLabel(h.file)}</span> : h.file.name} · {locationShort(h.amount)}
      {h.amount.label ? ` · ${h.amount.label}` : ''} · <span className="num">{formatMoney(h.amount.value, h.amount.decimals)}</span>
    </Ev>
  );
}

export function NearText({ near, target, decimals }: { near: NearMiss<Amount>; target: number; decimals: number }) {
  const h = amountIndex().get(near.item.id);
  if (!h) return null;
  return (
    <span className="muted">
      {near.transposed ? <span className="pill typo">Two digits swapped?</span> : 'Close:'}{' '}
      <Ev amount={h.amount}>{fileLabel(h.file)} · {h.amount.label || locationShort(h.amount)} · {formatMoney(near.value, h.amount.decimals)}</Ev> ({diffPhrase(near.diff, target, decimals)})
    </span>
  );
}

export const formatTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
