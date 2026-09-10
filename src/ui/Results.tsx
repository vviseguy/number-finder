import { IconArrowsExchange, IconSearch } from '@tabler/icons-react';
import { amountIndex, groupName, retryWith, showPreview, useAppState, type SearchRun } from '../state/store';
import { diffPhrase, formatMoney, locationShort, madeOfLabel, ROUNDING_SHORT } from '../lib/format';
import type { Match, MatchItem } from '../types';
import { arrowNav } from './common';
import { Preview } from './Preview';

export function Results() {
  const s = useAppState();
  const r = s.searches.find(x => x.id === s.selectedSearchId);
  if (!r) {
    return s.files.length ? (
      <p className="empty-note main-empty">Type a number above and press Enter, or open a file and click one of its numbers.</p>
    ) : null;
  }
  const items = r.matches.flatMap(m => m.items.map(i => i.id));
  const previewId = s.previewId ?? items[0] ?? null;

  return (
    <section className="results" aria-labelledby="h-results">
      <h3 id="h-results" className="sub-h">
        Results for <span className="num">{formatMoney(r.target, r.targetDecimals)}</span>
        {r.matches.length > 0 && <span className="count push">↑ ↓ to move · Enter shows it</span>}
      </h3>
      {r.status === 'running' && !r.matches.length && <p className="muted pad">Searching…</p>}
      {r.status === 'idle' && <p className="muted pad">This search is from an earlier session. Add its files and press Run.</p>}
      {r.status === 'done' && !r.matches.length && <NotFound run={r} />}
      {r.matches.length > 0 && (
        <div className="result-list" onKeyDown={arrowNav}>
          {r.matches.map((m, i) => <MatchRows key={i} match={m} run={r} previewId={previewId} />)}
        </div>
      )}
      {previewId && <Preview amountId={previewId} navIds={items} onNavigate={showPreview} />}
    </section>
  );
}

function MatchRows({ match, run, previewId }: { match: Match; run: SearchRun; previewId: string | null }) {
  if (match.items.length === 1) return <ItemRow item={match.items[0]} match={match} run={run} previewId={previewId} />;
  return (
    <div className="combo">
      <div className="combo-head">
        <span>Made of {match.items.length} numbers</span>
        <span className="num">= {formatMoney(match.sum)}</span>
      </div>
      {match.items.map(it => <ItemRow key={it.id} item={it} run={run} previewId={previewId} nested />)}
    </div>
  );
}

function ItemRow({ item, match, run, previewId, nested }: { item: MatchItem; match?: Match; run: SearchRun; previewId: string | null; nested?: boolean }) {
  const hit = amountIndex().get(item.id);
  if (!hit) return null;
  const { amount, file } = hit;
  const value = item.sign * amount.value;
  const off = match && Math.abs(match.diff) >= 0.005;
  const roundsTo = off && run.targetDecimals === 0 && Math.round(match.sum) === run.target;
  return (
    <button
      type="button"
      data-nav
      className={`result-row${nested ? ' nested' : ''}${item.id === previewId ? ' selected' : ''}`}
      onClick={() => showPreview(item.id)}
    >
      <span className="where">
        <b>{file.name}</b> · {locationShort(amount)}
        {amount.label && <span className="label"> {amount.label}</span>}
        {item.sign === -1 && <span className="pill flip"><IconArrowsExchange size={11} aria-hidden /> counted as negative</span>}
      </span>
      <span className="amount num">
        {formatMoney(value, amount.decimals)}
        {off && <span className="sub">{roundsTo ? `rounds to ${formatMoney(run.target, 0)}` : `off by ${formatMoney(Math.abs(match.diff))}`}</span>}
      </span>
    </button>
  );
}

function NotFound({ run: r }: { run: SearchRun }) {
  const s = useAppState();
  const near = r.nearest && amountIndex(s).get(r.nearest.id);
  const how = `${madeOfLabel(r.settings.maxCount) === '1 number' ? 'as a single number' : `using ${madeOfLabel(r.settings.maxCount)} numbers`}, ${ROUNDING_SHORT[r.settings.rounding]}`;
  const tries: { label: string; patch: Parameters<typeof retryWith>[3] }[] = [];
  if (r.settings.maxCount !== null && r.settings.maxCount < 3) tries.push({ label: 'Try up to 3 numbers', patch: { maxCount: 3, groupId: r.settings.groupId } });
  if (!r.settings.allowFlips) tries.push({ label: 'Also try negatives', patch: { allowFlips: true, groupId: r.settings.groupId } });
  if (r.settings.rounding === 'exact') tries.push({ label: 'Round to whole dollars', patch: { rounding: 'dollar', groupId: r.settings.groupId } });

  return (
    <div className="not-found">
      <p><b>Not found.</b> Nothing in {groupName(s, r.settings.groupId)} makes {formatMoney(r.target, r.targetDecimals)} {how}.</p>
      {r.reason === 'timeLimit' && <p className="muted">The search hit its time limit before checking every combination.</p>}
      {near && r.nearest && (
        <button type="button" className="nearest" onClick={() => showPreview(near.amount.id)}>
          <span className="muted">Nearest number</span>
          <span><b>{near.file.name}</b> · {locationShort(near.amount)} {near.amount.label && <span className="label">{near.amount.label}</span>}</span>
          <span><span className="num">{formatMoney(r.nearest.sign * near.amount.value, near.amount.decimals)}</span> <span className="muted">{diffPhrase(r.nearest.diff, r.target, r.targetDecimals)}</span></span>
        </button>
      )}
      {tries.length > 0 && (
        <div className="line">
          {tries.map(t => (
            <button key={t.label} type="button" className="btn sm" onClick={() => retryWith(r.target, r.targetDecimals, r.originId, t.patch)}>
              <IconSearch size={12} aria-hidden /> {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
