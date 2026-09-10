import { useEffect, useMemo, useState } from 'react';
import { IconArrowsExchange, IconChevronLeft, IconDownload, IconPlayerStop, IconSearch } from '@tabler/icons-react';
import {
  amountIndex, closeCheck, groupById, groupName, retryWith, settingsSummary, startCheck, stopCheck, useAppState,
  type CheckRow, type RowStatus,
} from '../state/store';
import { diffPhrase, formatMoney, locationShort, madeOfPhrase, plural, ROUNDING_SHORT } from '../lib/format';
import { download, exportCsv, exportXlsx, type ExportRow } from '../lib/exporter';
import type { Match } from '../types';
import { GroupTag } from './common';
import { Preview } from './Preview';

type Filter = 'all' | RowStatus;
const RANK: Record<RowStatus, number> = { notfound: 0, combo: 1, found: 2, pending: 3 };
const STATUS_LABEL: Record<RowStatus, string> = { notfound: 'Not found', combo: 'Made of', found: 'Found', pending: 'Checking' };

export function CheckView() {
  const s = useAppState();
  const run = s.check!;
  const idx = amountIndex(s);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<RowStatus, number> = { notfound: 0, combo: 0, found: 0, pending: 0 };
    for (const r of run.rows) c[r.status]++;
    return c;
  }, [run.rows]);

  const order = useMemo(() => new Map(run.rows.map((r, i) => [r.amountId, i])), [run.rows]);
  const rows = useMemo(
    () => run.rows
      .filter(r => filter === 'all' || r.status === filter)
      .slice()
      .sort((a, b) => RANK[a.status] - RANK[b.status] || order.get(a.amountId)! - order.get(b.amountId)!),
    [run.rows, filter, order],
  );
  const current = run.rows.find(r => r.amountId === selected) ?? rows[0] ?? null;

  // N jumps to the next not-found row; ↑ ↓ move through the table.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, select, textarea')) return;
      const i = current ? rows.indexOf(current) : -1;
      if (e.key === 'n' || e.key === 'N') {
        const next = [...rows.slice(i + 1), ...rows.slice(0, i + 1)].find(r => r.status === 'notfound');
        if (next) { setSelected(next.amountId); setPreviewId(null); e.preventDefault(); }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const next = rows[e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)];
        if (next) { setSelected(next.amountId); setPreviewId(null); e.preventDefault(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, current]);

  const done = run.rows.length - counts.pending;
  const checkGroup = groupById(s, run.checkGroupId);
  const againstGroup = groupById(s, run.againstGroupId);
  const settingsText = `Each number in ${groupName(s, run.checkGroupId)} is looked up in ${groupName(s, run.againstGroupId)} · ${settingsSummary(s, run.settings)}`;

  const exportRows = (): ExportRow[] => rows.map(r => {
    const hit = idx.get(r.amountId);
    const best = r.matches[0];
    return {
      status: r.status === 'combo' && best ? `Made of ${best.items.length}` : STATUS_LABEL[r.status],
      file: hit?.file.name ?? '',
      where: hit ? locationShort(hit.amount) : '',
      label: hit?.amount.label ?? '',
      amount: hit?.amount.value ?? 0,
      source: best ? describeMatch(best) : r.nearest ? `Nearest: ${describeItem(r.nearest.id, r.nearest.sign)}` : '',
      difference: best ? round2(best.diff) : r.nearest ? round2(r.nearest.diff) : null,
    };
  });
  const describeItem = (id: string, sign: 1 | -1) => {
    const h = idx.get(id);
    return h ? `${h.file.name} · ${locationShort(h.amount)}${h.amount.label ? ` · ${h.amount.label}` : ''} · ${formatMoney(sign * h.amount.value, h.amount.decimals)}` : '';
  };
  const describeMatch = (m: Match) => m.items.map(it => describeItem(it.id, it.sign)).join(' + ');
  const baseName = `Check ${groupName(s, run.checkGroupId)} against ${groupName(s, run.againstGroupId)}`.replace(/[\\/:*?"<>|]/g, '-');

  return (
    <div className="check-view">
      <div className="check-top">
        <button type="button" className="btn sm" onClick={closeCheck}><IconChevronLeft size={13} aria-hidden /> Back</button>
        <h2 className="check-title">Check <GroupTag group={checkGroup} name={groupName(s, run.checkGroupId)} /> against <GroupTag group={againstGroup} name={groupName(s, run.againstGroupId)} /></h2>
        <span className="push line">
          <button type="button" className="btn sm" onClick={async () => download(await exportXlsx(exportRows(), { title: baseName, settings: settingsText }), `${baseName}.xlsx`)}>
            <IconDownload size={13} aria-hidden /> Export to Excel
          </button>
          <button type="button" className="btn sm" onClick={() => download(exportCsv(exportRows()), `${baseName}.csv`)}>
            <IconDownload size={13} aria-hidden /> CSV
          </button>
        </span>
      </div>
      <p className="hint">{settingsText}{run.skippedZeros > 0 && ` · ${plural(run.skippedZeros, 'zero amount')} skipped`}</p>

      <div className="card progress-card">
        <div className="line">
          {run.status === 'running'
            ? <span className="accent">Checking · {done} of {run.rows.length} numbers</span>
            : <span>{run.status === 'stopped' ? `Stopped · ${done} of ${run.rows.length} checked` : `Checked ${plural(run.rows.length, 'number')}`}</span>}
          <span className="push">
            {run.status === 'running'
              ? <button type="button" className="btn sm" onClick={stopCheck}><IconPlayerStop size={12} aria-hidden /> Stop</button>
              : <button type="button" className="btn sm" onClick={() => startCheck(run.checkGroupId, run.againstGroupId, run.settings)}>Run again</button>}
          </span>
        </div>
        <span className="bar" role="progressbar" aria-label="Checked" aria-valuemin={0} aria-valuemax={run.rows.length} aria-valuenow={done}>
          <span style={{ width: `${run.rows.length ? (done / run.rows.length) * 100 : 100}%` }} />
        </span>
        <p className="hint">
          <span className="danger">{counts.notfound} not found</span> · {counts.combo} made of several · <span className="ok">{counts.found} found</span>
          {counts.pending > 0 && ` · ${counts.pending} still to check`}
        </p>
      </div>

      <div className="chips" role="radiogroup" aria-label="Show">
        {([['all', `All ${run.rows.length}`], ['notfound', `Not found ${counts.notfound}`], ['combo', `Made of several ${counts.combo}`], ['found', `Found ${counts.found}`]] as [Filter, string][]).map(([f, text]) => (
          <button key={f} type="button" role="radio" aria-checked={filter === f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{text}</button>
        ))}
        <span className="hint push">Not found first · <kbd>N</kbd> next not found · <kbd>↑</kbd><kbd>↓</kbd> move</span>
      </div>

      <div className="table-wrap">
        <table className="tieout">
          <thead>
            <tr><th>Status</th><th>Number in {groupName(s, run.checkGroupId)}</th><th className="num">Amount</th><th>Where it comes from</th></tr>
          </thead>
          <tbody>
            {rows.map(r => <TieRow key={r.amountId} row={r} selected={current?.amountId === r.amountId} onSelect={() => { setSelected(r.amountId); setPreviewId(null); }} />)}
            {!rows.length && <tr><td colSpan={4} className="muted pad">Nothing to show with this filter.</td></tr>}
          </tbody>
        </table>
      </div>

      {current && (
        <div className="check-detail">
          <Detail row={current} onShow={setPreviewId} runSettings={run} />
          <Preview amountId={previewId ?? current.amountId} />
        </div>
      )}
    </div>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function TieRow({ row, selected, onSelect }: { row: CheckRow; selected: boolean; onSelect: () => void }) {
  const s = useAppState();
  const idx = amountIndex(s);
  const hit = idx.get(row.amountId);
  if (!hit) return null;
  const best = row.matches[0];
  return (
    <tr className={selected ? 'selected' : ''} onClick={onSelect} aria-selected={selected}>
      <td><StatusPill row={row} /></td>
      <td>
        <button type="button" className="row-btn" onClick={onSelect}><b>{hit.file.name}</b> · {locationShort(hit.amount)}</button>
        {hit.amount.label && <div className="label">{hit.amount.label}</div>}
      </td>
      <td className="num">{formatMoney(hit.amount.value, hit.amount.decimals)}</td>
      <td>
        {row.status === 'pending' && <span className="muted">Checking…</span>}
        {best && <MatchText match={best} />}
        {row.status === 'notfound' && (row.nearest ? <NearestText id={row.nearest.id} diff={row.nearest.diff} target={hit.amount.value} decimals={hit.amount.decimals} /> : <span className="muted">Nothing close</span>)}
      </td>
    </tr>
  );
}

function StatusPill({ row }: { row: CheckRow }) {
  const n = row.matches[0]?.items.length ?? 0;
  const cls = { notfound: 'bad', combo: 'mixed', found: 'good', pending: 'wait' }[row.status];
  return <span className={`pill ${cls}`}>{row.status === 'combo' ? `Made of ${n}` : STATUS_LABEL[row.status]}</span>;
}

function MatchText({ match }: { match: Match }) {
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
            {h.file.name} · {locationShort(h.amount)}{match.items.length === 1 && h.amount.label ? ` · ${h.amount.label}` : ''} · <span className="num">{formatMoney(h.amount.value, h.amount.decimals)}</span>
          </span>
        );
      })}
    </span>
  );
}

function NearestText({ id, diff, target, decimals }: { id: string; diff: number; target: number; decimals: number }) {
  const h = amountIndex().get(id);
  if (!h) return null;
  return <span className="muted">Nearest: {h.file.name} · {h.amount.label || locationShort(h.amount)} · {formatMoney(h.amount.value, h.amount.decimals)} ({diffPhrase(diff, target, decimals)})</span>;
}

function Detail({ row, onShow, runSettings }: { row: CheckRow; onShow: (id: string) => void; runSettings: { againstGroupId: string; settings: { maxCount: number | null; rounding: 'exact' | 'cent' | 'dollar'; allowFlips: boolean } } }) {
  const s = useAppState();
  const idx = amountIndex(s);
  const hit = idx.get(row.amountId);
  if (!hit) return null;
  const { amount } = hit;
  const st = runSettings.settings;

  return (
    <div className="card detail">
      <p className="detail-title"><StatusPill row={row} /> <span className="num">{formatMoney(amount.value, amount.decimals)}</span></p>
      <p className="muted">{hit.file.name} · {locationShort(amount)}{amount.label && ` · ${amount.label}`}</p>

      {row.status === 'pending' && <p className="muted">Still checking…</p>}

      {row.matches.length > 0 && (
        <div className="detail-matches">
          {row.matches.map((m, i) => (
            <div key={i} className="detail-match">
              {row.matches.length > 1 && <span className="muted">{i === 0 ? 'Best match' : `Also: option ${i + 1}`}</span>}
              {m.items.map(it => {
                const h = idx.get(it.id);
                if (!h) return null;
                return (
                  <button key={it.id} type="button" className="result-row nested" onClick={() => onShow(it.id)}>
                    <span className="where"><b>{h.file.name}</b> · {locationShort(h.amount)} {h.amount.label && <span className="label">{h.amount.label}</span>}
                      {it.sign === -1 && <span className="pill flip"><IconArrowsExchange size={11} aria-hidden /> counted as negative</span>}
                    </span>
                    <span className="amount num">{formatMoney(it.sign * h.amount.value, h.amount.decimals)}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {row.status === 'notfound' && (
        <>
          <p>Nothing in {groupName(s, runSettings.againstGroupId)} makes {formatMoney(amount.value, amount.decimals)} {madeOfPhrase(st.maxCount)}, {ROUNDING_SHORT[st.rounding]}.</p>
          {row.nearest && (() => {
            const n = idx.get(row.nearest.id);
            return n ? (
              <button type="button" className="nearest" onClick={() => onShow(n.amount.id)}>
                <span className="muted">Nearest number</span>
                <span><b>{n.file.name}</b> · {locationShort(n.amount)} {n.amount.label && <span className="label">{n.amount.label}</span>}</span>
                <span><span className="num">{formatMoney(row.nearest.sign * n.amount.value, n.amount.decimals)}</span> <span className="muted">{diffPhrase(row.nearest.diff, amount.value, amount.decimals)}</span></span>
              </button>
            ) : null;
          })()}
          <div className="line">
            <button
              type="button"
              className="btn sm"
              onClick={() => retryWith(amount.value, amount.decimals, amount.id, { groupId: runSettings.againstGroupId, maxCount: null, allowFlips: true, rounding: st.rounding })}
            >
              <IconSearch size={12} aria-hidden /> Search {formatMoney(amount.value, amount.decimals)} with any count and negatives
            </button>
          </div>
        </>
      )}
    </div>
  );
}
