import { useMemo, type ReactNode } from 'react';
import { IconArrowsExchange, IconEye, IconSearch } from '@tabler/icons-react';
import { amountIndex, groupAmounts, groupName, retryWith, showPreview, useAppState, type CheckRow, type CheckRun } from '../state/store';
import { hoverProps, useLinkClass } from '../state/hover';
import { formatMoney, locationShort, madeOfPhrase, ROUNDING_SHORT } from '../lib/format';
import { findNearMiss } from '../lib/nearmiss';
import { passesTerms } from '../lib/query';
import type { Amount, MatchItem } from '../types';
import { NearButton } from './NearButton';
import { Preview } from './Preview';
import { defaultRow, StatusPill } from './checkParts';

/** The right-hand pane: where the selected number sits in its file, plus a check row's details. */
export function SidePane() {
  const s = useAppState();
  const run = s.runs.find(r => r.id === s.selectedRunId);
  let content: ReactNode = null;

  if (run?.kind === 'search') {
    const items = run.matches.flatMap(m => m.items.map(i => i.id));
    const id = s.previewId ?? items[0] ?? null;
    if (id) content = <Preview amountId={id} navIds={items} onNavigate={showPreview} />;
  } else if (run?.kind === 'check' && run.rows.length) {
    const row = run.rows.find(r => r.amountId === run.selectedAmountId) ?? defaultRow(run) ?? run.rows[0];
    content = (
      <>
        <CheckDetail run={run} row={row} />
        <Preview amountId={s.previewId ?? row.amountId} />
      </>
    );
  } else if (s.previewId) {
    content = <Preview amountId={s.previewId} />;
  }

  return (
    <aside className="side-pane" aria-label="Where the number is">
      {content ?? (
        <div className="pane-empty">
          <IconEye size={24} stroke={1.5} aria-hidden />
          <p>Pick a result to see it in its file.</p>
          <p className="hint">Every number there is clickable: click one to search for it.</p>
        </div>
      )}
    </aside>
  );
}

function CheckDetail({ run, row }: { run: CheckRun; row: CheckRow }) {
  const s = useAppState();
  const idx = amountIndex(s);
  const hit = idx.get(row.amountId);
  const near = useMemo(() => {
    if (!hit || (row.status !== 'notfound' && row.status !== 'combo')) return null;
    const pool = groupAmounts(s, run.settings.groupId).filter(a => a.id !== row.amountId && passesTerms(a, idx.get(a.id)?.file.name ?? '', run.terms));
    return findNearMiss(hit.amount.value, hit.amount.decimals, pool, a => a.value, run.settings.allowFlips);
  }, [hit, row, run.settings, run.terms, s, idx]);
  if (!hit) return null;
  const { amount } = hit;
  const st = run.settings;

  return (
    <div className="card detail">
      <p className="detail-title"><StatusPill row={row} stopped={run.status === 'stopped'} /> <span className="num">{formatMoney(amount.value, amount.decimals)}</span></p>
      <p className="muted">{hit.file.name} · {locationShort(amount)}{amount.label && ` · ${amount.label}`}</p>

      {row.status === 'pending' && <p className="muted">{run.status === 'stopped' ? "This number wasn't checked before the check was stopped." : 'Still checking…'}</p>}

      {row.matches.length > 0 && (
        <div className="detail-matches">
          {row.matches.map((m, i) => (
            <div key={i} className="detail-match">
              {row.matches.length > 1 && <span className="muted">{i === 0 ? 'Best match' : `Also: option ${i + 1}`}</span>}
              {m.items.map(it => <DetailRow key={it.id} item={it} selected={s.previewId === it.id} />)}
            </div>
          ))}
        </div>
      )}

      {row.status === 'combo' && near?.transposed && (
        <>
          <p className="muted">This sum could be a coincidence: a single number matches except for two swapped digits.</p>
          <NearButton near={near} target={amount.value} decimals={amount.decimals} onShow={showPreview} />
        </>
      )}

      {row.status === 'notfound' && (
        <>
          <p>Nothing in {groupName(s, st.groupId)} makes {formatMoney(amount.value, amount.decimals)} {madeOfPhrase(st.maxCount)}, {ROUNDING_SHORT[st.rounding]}.</p>
          {near
            ? <NearButton near={near} target={amount.value} decimals={amount.decimals} onShow={showPreview} />
            : <p className="muted">Nothing in {groupName(s, st.groupId)} is close to it either.</p>}
          <div className="line">
            <button
              type="button"
              className="btn sm"
              onClick={() => retryWith(amount.value, amount.decimals, amount.id, run.terms, { groupId: st.groupId, maxCount: null, allowFlips: true, rounding: st.rounding })}
            >
              <IconSearch size={12} aria-hidden /> Search {formatMoney(amount.value, amount.decimals)} with any sum and negatives
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function DetailRow({ item, selected }: { item: MatchItem; selected: boolean }) {
  const h = amountIndex().get(item.id);
  const link = useLinkClass(h?.amount ?? null);
  if (!h) return null;
  const a: Amount = h.amount;
  return (
    <button type="button" className={`result-row nested${selected ? ' selected' : ''}${link}`} onClick={() => showPreview(item.id)} {...hoverProps(a)}>
      <span className="where"><b>{h.file.name}</b> · {locationShort(a)} {a.label && <span className="label">{a.label}</span>}
        {item.sign === -1 && <span className="pill flip"><IconArrowsExchange size={11} aria-hidden /> counted as negative</span>}
      </span>
      <span className="amount num">{formatMoney(item.sign * a.value, a.decimals)}</span>
    </button>
  );
}
