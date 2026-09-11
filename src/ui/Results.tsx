import { useState } from 'react';
import { IconArrowsExchange, IconChevronDown, IconHistory, IconSearch, IconUpload } from '@tabler/icons-react';
import { chooseFiles } from './FindBar';
import { FolderLine, SetupButtons } from './FilesView';
import {
  amountIndex, fileLabel, fileTermText, groupAmounts, groupName, restoreVersion, retryWith, setResultSort, showPreview, shownRun, sortedMatches, targetText,
  useAppState, viewVersion, type Run, type SearchRun,
} from '../state/store';
import { hoverProps, useLinkClass } from '../state/hover';
import { formatMoney, locationShort, madeOfPhrase, plural, roundingPhrase } from '../lib/format';
import { findNearMiss } from '../lib/nearmiss';
import { passesTerms, termsPhrase } from '../lib/query';
import { SORT_LABEL, SORTS, type ResultSort } from '../lib/rank';
import type { Match, MatchItem } from '../types';
import { arrowNav } from './common';
import { CheckResults } from './CheckResults';
import { Equation, sumTitle } from './Equation';
import { formatTime } from './checkParts';
import { Money } from './Money';
import { NearButton } from './NearButton';
import { Pick } from './Pick';
import { VersionPicker } from './RunList';

export function Results() {
  const s = useAppState();
  const live = s.runs.find(r => r.id === s.selectedRunId);
  if (!live) {
    if (!s.files.length) {
      return (
        <div className="prompt">
          <div className="card add-files-prompt">
            <IconUpload size={26} stroke={1.5} aria-hidden />
            <p><b>Add your tax documents to start.</b></p>
            <p className="muted">Drop PDFs, Excel workbooks, or CSV files anywhere on this page. They're read inside the page and never uploaded.</p>
            {s.folder && <FolderLine folder={s.folder} />}
            <span className="line center">
              <button type="button" className="btn" onClick={chooseFiles}>Choose files</button>
              <SetupButtons compact />
            </span>
          </div>
        </div>
      );
    }
    return (
      <div className="prompt">
        <p className="empty-note main-empty">
          {s.runs.length ? 'Pick a search from the history, or type a number in the bar above.' : 'Type a number in the bar above and press Enter, or open a file and click one of its numbers.'}
        </p>
      </div>
    );
  }
  const { run, past } = shownRun(live);
  return (
    <>
      <VersionBar live={live} past={past} />
      {run.kind === 'search' ? <SearchResults run={run} readOnly={past} /> : <CheckResults run={run} readOnly={past} />}
    </>
  );
}

/** The slim bar above results: which version this is, when it ran, and how to move between versions. */
function VersionBar({ live, past }: { live: Run; past: boolean }) {
  if (!past) {
    return (
      <div className="version-bar" role="status">
        <IconHistory size={14} aria-hidden />
        <span>Version {live.version}{live.version > 1 ? ` of ${live.version}` : ''} · {formatTime(live.at)}</span>
        {live.history.length > 0 && <span className="push"><VersionPicker run={live} /></span>}
      </div>
    );
  }
  const i = live.viewing!;
  const v = live.history[i];
  return (
    <div className="version-bar past" role="status">
      <IconHistory size={14} aria-hidden />
      <span>Version {i + 1} of {live.version} · {formatTime(v.at)} · read-only; the current version is v{live.version}</span>
      <span className="push line">
        <VersionPicker run={live} />
        <button type="button" className="btn sm" onClick={() => viewVersion(live.id, null)}>Back to current</button>
        <button type="button" className="btn sm" onClick={() => restoreVersion(live.id, i)}>Restore as v{live.version + 1}</button>
      </span>
    </div>
  );
}

function SearchResults({ run: r, readOnly }: { run: SearchRun; readOnly: boolean }) {
  const s = useAppState();
  const matches = sortedMatches(s, r);
  const previewId = s.previewId ?? matches[0]?.items[0].id ?? null;

  return (
    <section className="results" aria-labelledby="h-results">
      <h3 id="h-results" className="sub-h">
        <span className="nowrap">Results for <span className="num">{targetText(r)}</span></span>
        {matches.length > 0 && <span className="count">{plural(matches.length, 'match', 'matches')} · ↑ ↓ to move · hover a number to see it elsewhere</span>}
        {matches.length > 1 && (
          <span className="push line sort-pick">
            <span className="label">Order</span>
            <Pick value={s.resultSort} label="Order of results" options={SORTS.map(k => ({ value: k, label: SORT_LABEL[k] }))} onChange={v => setResultSort(v as ResultSort)} />
          </span>
        )}
      </h3>
      {r.status === 'running' && !matches.length && <p className="muted pad">Searching…</p>}
      {r.status === 'idle' && <p className="muted pad">This search is from an earlier session. Add its files and press Run.</p>}
      {r.status === 'done' && !matches.length && <NotFound run={r} readOnly={readOnly} />}
      {matches.length > 0 && (
        <div className="result-list" onKeyDown={arrowNav}>
          {matches.map(m => <MatchRows key={m.items.map(i => `${i.sign < 0 ? '-' : ''}${i.id}`).join('+')} match={m} run={r} previewId={previewId} />)}
        </div>
      )}
    </section>
  );
}

/** A sum: a title line, the equation along the bottom (trimmed to … with the total always visible), and the rows when opened. */
function MatchRows({ match, run, previewId }: { match: Match; run: SearchRun; previewId: string | null }) {
  const [open, setOpen] = useState(false);
  if (match.items.length === 1) return <ItemRow item={match.items[0]} match={match} run={run} previewId={previewId} />;
  const holdsSelected = match.items.some(it => it.id === previewId);
  return (
    <div className={`combo${open ? ' open' : ''}${holdsSelected ? ' has-selected' : ''}`}>
      <button type="button" className="combo-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="combo-title" title={sumTitle(match)}>{sumTitle(match)}</span>
        <IconChevronDown size={16} className="chev" aria-hidden />
        <Equation match={match} withFiles={false} layout="row" />
      </button>
      {open && match.items.map(it => <ItemRow key={it.id} item={it} run={run} previewId={previewId} nested />)}
    </div>
  );
}

function ItemRow({ item, match, run, previewId, nested }: { item: MatchItem; match?: Match; run: SearchRun; previewId: string | null; nested?: boolean }) {
  const hit = amountIndex().get(item.id);
  const link = useLinkClass(hit?.amount ?? null);
  if (!hit) return null;
  const { amount, file } = hit;
  const off = match && !run.range && Math.abs(match.diff) >= 0.005;
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
        <b title={file.name}>{fileLabel(file)}</b> · {locationShort(amount)}
        {amount.label && <span className="label"> {amount.label}</span>}
        {item.sign === -1 && <span className="pill flip"><IconArrowsExchange size={11} aria-hidden /> counted as negative</span>}
      </span>
      <span className="amount">
        <Money value={amount.value} decimals={amount.decimals} flipped={item.sign === -1} />
        {off && <span className="sub">{roundsTo ? `rounds to ${formatMoney(run.target, 0)}` : `off by ${formatMoney(Math.abs(match.diff))}`}</span>}
      </span>
    </button>
  );
}

function NotFound({ run: r, readOnly }: { run: SearchRun; readOnly: boolean }) {
  const s = useAppState();
  const idx = amountIndex(s);
  const candidates = groupAmounts(s, r.settings.groupId)
    .filter(a => a.id !== r.originId && passesTerms(a, idx.get(a.id) ? fileTermText(idx.get(a.id)!.file) : '', r.terms));
  const near = r.range ? null : findNearMiss(r.target, r.targetDecimals, candidates, a => a.value, r.settings.allowFlips);
  const how = r.range ? '' : ` ${madeOfPhrase(r.settings.maxCount, r.settings.minCount)}, ${roundingPhrase(r.settings.rounding, r.settings.tolerance)}`;
  const filters = termsPhrase(r.terms);
  const tries: { label: string; patch: Parameters<typeof retryWith>[1] }[] = [];
  if (!r.range) {
    if ((r.settings.minCount ?? 1) > 1) tries.push({ label: `Try sums of up to ${r.settings.maxCount ?? 'any size'}`, patch: { minCount: undefined } });
    else if (r.settings.maxCount !== null && r.settings.maxCount < 3) tries.push({ label: 'Try sums of up to 3', patch: { maxCount: 3, minCount: undefined } });
    if (!r.settings.allowFlips) tries.push({ label: 'Also try negatives', patch: { allowFlips: true, maxFlips: undefined } });
    else if (r.settings.maxFlips !== undefined) tries.push({ label: 'Allow any number of negatives', patch: { maxFlips: undefined } });
    if (r.settings.rounding === 'exact' || r.settings.tolerance === 0) tries.push({ label: 'Round to whole dollars', patch: { rounding: 'dollar' } });
  }

  return (
    <div className="not-found">
      <p><b>Not found.</b> {r.range ? `No number in ${groupName(s, r.settings.groupId)} falls between ${targetText(r).replace('..', ' and ')}` : `Nothing in ${groupName(s, r.settings.groupId)} makes ${formatMoney(r.target, r.targetDecimals)}${how}`}{filters && ` (${filters})`}.</p>
      {r.reason === 'timeLimit' && <p className="muted">The search hit its time limit before checking every combination.</p>}
      {near
        ? <NearButton near={near} target={r.target} decimals={r.targetDecimals} onShow={showPreview} />
        : !r.range && <p className="muted">Nothing in {groupName(s, r.settings.groupId)} is close to it either.</p>}
      {!readOnly && tries.length > 0 && (
        <div className="line">
          {tries.map(t => (
            <button key={t.label} type="button" className="btn sm" title="Runs as a new version of this search" onClick={() => retryWith(r.id, t.patch)}>
              <IconSearch size={12} aria-hidden /> {t.label}
            </button>
          ))}
          <span className="hint">each runs as a new version</span>
        </div>
      )}
    </div>
  );
}
