import { useEffect, useMemo, useState } from 'react';
import { IconDownload, IconPlayerStop } from '@tabler/icons-react';
import {
  amountIndex, fileLabel, fileTermText, groupAmounts, groupById, groupName, rerunRun, runSummary, selectCheckRow, stopRun, useAppState,
  type CheckRow, type CheckRun, type RowStatus,
} from '../state/store';
import { hoverProps, useLinkClass } from '../state/hover';
import { formatMoney, locationShort, plural } from '../lib/format';
import { download, exportCsv, exportXlsx, type ExportRow } from '../lib/exporter';
import { findNearMiss, type NearMiss } from '../lib/nearmiss';
import { passesTerms } from '../lib/query';
import type { Amount, Match } from '../types';
import { GroupTag } from './common';
import { defaultRow, NearText, SingleText, sortRows, StatusPill } from './checkParts';
import { Equation } from './Equation';

type Filter = 'all' | RowStatus;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The tie-out table for "every number in a group". Its detail and preview live in the side pane. */
export function CheckResults({ run, readOnly }: { run: CheckRun; readOnly: boolean }) {
  const s = useAppState();
  const idx = amountIndex(s);
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(() => {
    const c: Record<RowStatus, number> = { notfound: 0, combo: 0, found: 0, pending: 0 };
    for (const r of run.rows) c[r.status]++;
    return c;
  }, [run.rows]);

  const rows = useMemo(() => sortRows(run.rows.filter(r => filter === 'all' || r.status === filter)), [run.rows, filter]);
  const current = run.rows.find(r => r.amountId === run.selectedAmountId) ?? defaultRow(run) ?? null;

  // Likely-intended numbers for misses, and swapped-digit singles that a coincidental sum could hide.
  const candidates = useMemo(
    () => groupAmounts(s, run.settings.groupId).filter(a => { const h = idx.get(a.id); return h ? passesTerms(a, fileTermText(h.file), run.terms) : false; }),
    [s.files, s.groups, run.settings.groupId, run.terms, idx], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const nearOf = useMemo(() => {
    const map = new Map<string, NearMiss<Amount> | null>();
    for (const r of run.rows) {
      if (r.status !== 'notfound' && r.status !== 'combo') continue;
      const hit = idx.get(r.amountId);
      if (hit) map.set(r.amountId, findNearMiss(hit.amount.value, hit.amount.decimals, candidates.filter(a => a.id !== r.amountId), a => a.value, run.settings.allowFlips));
    }
    return map;
  }, [run.rows, candidates, idx, run.settings.allowFlips]);

  // N jumps to the next not-found row; ↑ ↓ move through the table (when not typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea, [role="menu"]')) return;
      const i = current ? rows.indexOf(current) : -1;
      let next: CheckRow | undefined;
      if (e.key === 'n' || e.key === 'N') next = [...rows.slice(i + 1), ...rows.slice(0, i + 1)].find(r => r.status === 'notfound');
      else if (e.key === 'ArrowDown') next = rows[Math.min(rows.length - 1, i + 1)];
      else if (e.key === 'ArrowUp') next = rows[Math.max(0, i - 1)];
      if (next) { e.preventDefault(); selectCheckRow(run.id, next.amountId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, current, run.id]);

  const done = run.rows.length - counts.pending;
  const checkName = groupName(s, run.checkGroupId);
  const againstName = groupName(s, run.settings.groupId);
  const settingsText = `Each number in ${checkName} is looked up ${runSummary(s, run)}`;
  const skipped = [
    run.skippedByTerms > 0 && `${plural(run.skippedByTerms, 'number')} skipped by the filters`,
    run.skippedZeros > 0 && `${plural(run.skippedZeros, 'zero amount')} skipped`,
  ].filter(Boolean).join(' · ');

  // Exports use full file names so they stand on their own.
  const describeItem = (id: string, sign: 1 | -1) => {
    const h = idx.get(id);
    return h ? `${h.file.name} · ${locationShort(h.amount)}${h.amount.label ? ` · ${h.amount.label}` : ''} · ${formatMoney(sign * h.amount.value, h.amount.decimals)}` : '';
  };
  const describeMatch = (m: Match) => m.items.map(it => describeItem(it.id, it.sign)).join(' + ');
  const exportRows = (): ExportRow[] => rows.map(r => {
    const hit = idx.get(r.amountId);
    const best = r.matches[0];
    const near = nearOf.get(r.amountId) ?? null;
    return {
      status: r.status === 'combo' && best ? `Made of ${best.items.length}` : r.status === 'pending' ? 'Not checked' : r.status === 'notfound' ? 'Not found' : 'Found',
      file: hit?.file.name ?? '',
      where: hit ? locationShort(hit.amount) : '',
      label: hit?.amount.label ?? '',
      amount: hit?.amount.value ?? 0,
      source: best
        ? describeMatch(best) + (near?.transposed ? ` · Possible typo: ${describeItem(near.item.id, near.sign)}` : '')
        : near ? `${near.transposed ? 'Possible typo (two digits swapped)' : 'Closest'}: ${describeItem(near.item.id, near.sign)}` : '',
      difference: best ? round2(best.diff) : near ? round2(near.diff) : null,
    };
  });
  const baseName = `Check ${checkName} against ${againstName}`.replace(/[\\/:*?"<>|]/g, '-');

  return (
    <section className="results check-results" aria-labelledby="h-check">
      <div className="check-top">
        <h3 id="h-check" className="sub-h check-title">
          Every number in <GroupTag group={groupById(s, run.checkGroupId)} name={checkName} /> against <GroupTag group={groupById(s, run.settings.groupId)} name={againstName} />
        </h3>
        <span className="push line">
          <button type="button" className="btn sm" onClick={async () => download(await exportXlsx(exportRows(), { title: baseName, settings: settingsText }), `${baseName}.xlsx`)}>
            <IconDownload size={13} aria-hidden /> Export to Excel
          </button>
          <button type="button" className="btn sm" onClick={() => download(exportCsv(exportRows()), `${baseName}.csv`)}>
            <IconDownload size={13} aria-hidden /> CSV
          </button>
        </span>
      </div>
      <p className="hint">{settingsText}{skipped && ` · ${skipped}`}</p>

      {run.status === 'idle' ? (
        <p className="muted pad">This check is from an earlier session. Add its files and press Run in the list above.</p>
      ) : (
        <>
          <div className="card progress-card">
            <div className="line">
              {run.status === 'running'
                ? <span className="accent">Checking · {done} of {run.rows.length} numbers</span>
                : <span>{run.status === 'stopped' ? `Stopped · ${done} of ${run.rows.length} checked` : `Checked ${plural(run.rows.length, 'number')}`}</span>}
              {!readOnly && (
                <span className="push">
                  {run.status === 'running'
                    ? <button type="button" className="btn sm" onClick={() => stopRun(run.id)}><IconPlayerStop size={12} aria-hidden /> Stop</button>
                    : <button type="button" className="btn sm" onClick={() => rerunRun(run.id)}>Run again</button>}
                </span>
              )}
            </div>
            <span className="bar" role="progressbar" aria-label="Checked" aria-valuemin={0} aria-valuemax={run.rows.length} aria-valuenow={done}>
              <span style={{ width: `${run.rows.length ? (done / run.rows.length) * 100 : 100}%` }} />
            </span>
            <p className="hint">
              <span className="danger">{counts.notfound} not found</span> · {counts.combo} made of several · <span className="ok">{counts.found} found</span>
              {counts.pending > 0 && ` · ${counts.pending} ${run.status === 'stopped' ? 'not checked' : 'still to check'}`}
            </p>
          </div>

          <div className="chips" role="radiogroup" aria-label="Show">
            {([['all', `All ${run.rows.length}`], ['notfound', `Not found ${counts.notfound}`], ['combo', `Made of several ${counts.combo}`], ['found', `Found ${counts.found}`]] as [Filter, string][]).map(([f, text]) => (
              <button key={f} type="button" role="radio" aria-checked={filter === f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{text}</button>
            ))}
            <span className="hint push">Not found first · <kbd>N</kbd> next not found · <kbd>↑</kbd><kbd>↓</kbd> move · hover a number to see it elsewhere</span>
          </div>

          <div className="table-wrap">
            <table className="tieout">
              <thead>
                <tr><th>Status</th><th>Number in {checkName}</th><th className="num">Amount</th><th>Where it comes from</th></tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <TieRow
                    key={r.amountId}
                    row={r}
                    near={nearOf.get(r.amountId) ?? null}
                    stopped={run.status === 'stopped'}
                    selected={current?.amountId === r.amountId}
                    onSelect={() => selectCheckRow(run.id, r.amountId)}
                  />
                ))}
                {!rows.length && <tr><td colSpan={4} className="muted pad">Nothing to show with this filter.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function TieRow({ row, near, stopped, selected, onSelect }: { row: CheckRow; near: NearMiss<Amount> | null; stopped: boolean; selected: boolean; onSelect: () => void }) {
  const hit = amountIndex().get(row.amountId);
  const link = useLinkClass(hit?.amount ?? null);
  if (!hit) return null;
  const best = row.matches[0];
  return (
    <tr className={`${selected ? 'selected' : ''}${link}`} onClick={onSelect} aria-selected={selected} {...hoverProps(hit.amount)}>
      <td><StatusPill row={row} stopped={stopped} /></td>
      <td>
        <button type="button" className="row-btn" onClick={onSelect}><b title={hit.file.name}>{fileLabel(hit.file)}</b> · {locationShort(hit.amount)}</button>
        {hit.amount.label && <div className="label">{hit.amount.label}</div>}
      </td>
      <td className="num">{formatMoney(hit.amount.value, hit.amount.decimals)}</td>
      <td>
        {row.status === 'pending' && <span className="muted">{stopped ? 'Not checked' : 'Checking…'}</span>}
        {best && (best.items.length === 1 ? <SingleText match={best} /> : <Equation match={best} />)}
        {best && near?.transposed && <span className="pill typo">Possible typo: {formatMoney(near.value, near.item.decimals)}</span>}
        {row.status === 'notfound' && (near ? <NearText near={near} target={hit.amount.value} decimals={hit.amount.decimals} /> : <span className="muted">Nothing close</span>)}
      </td>
    </tr>
  );
}
