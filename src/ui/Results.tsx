import { IconArrowsExchange, IconSearch } from '@tabler/icons-react';
import { amountIndex, groupAmounts, groupName, retryWith, showPreview, useAppState, type SearchRun } from '../state/store';
import { hoverProps, useLinkClass } from '../state/hover';
import { formatMoney, locationShort, madeOfPhrase, ROUNDING_SHORT } from '../lib/format';
import { findNearMiss } from '../lib/nearmiss';
import { passesTerms, termsPhrase } from '../lib/query';
import type { Match, MatchItem } from '../types';
import { arrowNav } from './common';
import { CheckResults } from './CheckResults';
import { NearButton } from './NearButton';

export function Results() {
  const s = useAppState();
  const run = s.runs.find(r => r.id === s.selectedRunId);
  if (!run) {
    return s.files.length ? (
      <p className="empty-note main-empty">Type a number above and press Enter, or open a file and click one of its numbers.</p>
    ) : null;
  }
  return run.kind === 'search' ? <SearchResults run={run} /> : <CheckResults run={run} />;
}

function SearchResults({ run: r }: { run: SearchRun }) {
  const s = useAppState();
  const items = r.matches.flatMap(m => m.items.map(i => i.id));
  const previewId = s.previewId ?? items[0] ?? null;

  return (
    <section className="results" aria-labelledby="h-results">
      <h3 id="h-results" className="sub-h">
        <span className="nowrap">Results for <span className="num">{formatMoney(r.target, r.targetDecimals)}</span></span>
        {r.matches.length > 0 && <span className="count push">↑ ↓ to move · hover a number to see it elsewhere</span>}
      </h3>
      {r.status === 'running' && !r.matches.length && <p className="muted pad">Searching…</p>}
      {r.status === 'idle' && <p className="muted pad">This search is from an earlier session. Add its files and press Run.</p>}
      {r.status === 'done' && !r.matches.length && <NotFound run={r} />}
      {r.matches.length > 0 && (
        <div className="result-list" onKeyDown={arrowNav}>
          {r.matches.map((m, i) => <MatchRows key={i} match={m} run={r} previewId={previewId} />)}
        </div>
      )}
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
  const link = useLinkClass(hit?.amount ?? null);
  if (!hit) return null;
  const { amount, file } = hit;
  const value = item.sign * amount.value;
  const off = match && Math.abs(match.diff) >= 0.005;
  const roundsTo = off && run.targetDecimals === 0 && Math.round(match.sum) === run.target;
  return (
    <button
      type="button"
      data-nav
      className={`result-row${nested ? ' nested' : ''}${item.id === previewId ? ' selected' : ''}${link}`}
      onClick={() => showPreview(item.id)}
      {...hoverProps(amount)}
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
  const idx = amountIndex(s);
  const candidates = groupAmounts(s, r.settings.groupId)
    .filter(a => a.id !== r.originId && passesTerms(a, idx.get(a.id)?.file.name ?? '', r.terms));
  const near = findNearMiss(r.target, r.targetDecimals, candidates, a => a.value, r.settings.allowFlips);
  const how = `${madeOfPhrase(r.settings.maxCount)}, ${ROUNDING_SHORT[r.settings.rounding]}`;
  const filters = termsPhrase(r.terms);
  const tries: { label: string; patch: Parameters<typeof retryWith>[4] }[] = [];
  if (r.settings.maxCount !== null && r.settings.maxCount < 3) tries.push({ label: 'Try sums of up to 3', patch: { maxCount: 3, groupId: r.settings.groupId } });
  if (!r.settings.allowFlips) tries.push({ label: 'Also try negatives', patch: { allowFlips: true, groupId: r.settings.groupId } });
  if (r.settings.rounding === 'exact') tries.push({ label: 'Round to whole dollars', patch: { rounding: 'dollar', groupId: r.settings.groupId } });

  return (
    <div className="not-found">
      <p><b>Not found.</b> Nothing in {groupName(s, r.settings.groupId)} makes {formatMoney(r.target, r.targetDecimals)} {how}{filters && ` (${filters})`}.</p>
      {r.reason === 'timeLimit' && <p className="muted">The search hit its time limit before checking every combination.</p>}
      {near
        ? <NearButton near={near} target={r.target} decimals={r.targetDecimals} onShow={showPreview} />
        : <p className="muted">Nothing in {groupName(s, r.settings.groupId)} is close to it either.</p>}
      {tries.length > 0 && (
        <div className="line">
          {tries.map(t => (
            <button key={t.label} type="button" className="btn sm" onClick={() => retryWith(r.target, r.targetDecimals, r.originId, r.terms, t.patch)}>
              <IconSearch size={12} aria-hidden /> {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
