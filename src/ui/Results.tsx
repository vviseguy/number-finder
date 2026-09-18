import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconArrowsExchange, IconChevronDown, IconChevronLeft, IconChevronRight, IconClock, IconHistory, IconLoader2, IconPlayerStop, IconSearch, IconUpload,
} from '@tabler/icons-react';
import { chooseFiles, FolderLine, OpenFolderButton } from './FilePicker';
import {
  amountIndex, fileLabel, fileTermText, restoreVersion, retryWith, searchSecondsOf, setResultSort, showPreview, shownRun, sortedMatches,
  scopeAmounts, scopePhrase, stopRun, SUM_MAX_RESULTS, targetText, useAppState, viewVersion, type Run, type SearchRun,
} from '../state/store';
import { hoverProps, useLinkClass } from '../state/hover';
import { elapsedLabel, formatMoney, locationShort, longerSeconds, madeOfPhrase, plural, roundingPhrase, secondsLabel, whichOne } from '../lib/format';
import { NarrowChips } from './Narrow';
import { findNearMiss } from '../lib/nearmiss';
import { lookalikeItems } from '../lib/lookalike';
import { passesTerms, termsPhrase } from '../lib/query';
import { SORT_HINT, SORT_LABEL, SORTS, type ResultSort } from '../lib/rank';
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
              <OpenFolderButton className="btn" />
            </span>
          </div>
        </div>
      );
    }
    return (
      <div className="prompt">
        <p className="empty-note main-empty">
          {s.runs.length ? 'Pick a search from the history, or type a number in the bar above.' : 'Type a number in the bar above and press Enter. The file list next to the search bar shows each file, and every number in a file is clickable.'}
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

/** Matches shown at once. A search may find thousands; the rest are a page away. */
const PAGE_SIZE = 100;

function SearchResults({ run: r, readOnly }: { run: SearchRun; readOnly: boolean }) {
  const s = useAppState();
  const matches = sortedMatches(s, r);
  const previewId = s.previewId ?? matches[0]?.items[0].id ?? null;
  const [page, setPage] = useState(0);
  const head = useRef<HTMLHeadingElement>(null);

  // A different search, a new version of one, or a new order: back to the first page.
  useEffect(() => setPage(0), [r.id, r.version, s.resultSort]);
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const at = Math.min(page, pages - 1);
  const shown = pages > 1 ? matches.slice(at * PAGE_SIZE, at * PAGE_SIZE + PAGE_SIZE) : matches;
  const goTo = (p: number) => { setPage(p); head.current?.scrollIntoView({ block: 'start' }); };

  // Two sums can hold different numbers that read the same (a W-2 has 85,000 in box 1 and again in box 3).
  // The face compared is what the row shows — its title and its numbers — and each number that needs one
  // gets a word: its label, with the file in front when the look-alikes are in different files. Worked
  // out over every match, not just this page, so a match reads the same wherever it appears.
  const idx = amountIndex(s);
  const distinguish = useMemo(() => {
    const face = (m: Match) => `${sumTitle(m)} :: ${m.items.map(it => `${it.sign}${idx.get(it.id)?.amount.value ?? it.id}`).join('+')}`;
    const out = new Map<string, string>();
    const done = new Set<string>();
    for (const sharing of lookalikeItems(matches, face).values()) {
      if (done.has(sharing.join('|'))) continue; // the ids sharing a spot are handled together, once
      done.add(sharing.join('|'));
      const hits = sharing.flatMap(id => { const h = idx.get(id); return h ? [{ id, ...h }] : []; });
      const where = new Set(hits.map(x => x.file)).size > 1 ? (x: typeof hits[0]) => `${fileLabel(x.file)} · ` : () => '';
      let texts = hits.map(x => `${where(x)}${whichOne(x.amount)}`);
      // The same label in two places (a repeated line, a column of totals): say where instead.
      if (new Set(texts).size < texts.length) texts = hits.map(x => `${where(x)}${locationShort(x.amount)}`);
      hits.forEach((x, i) => out.set(x.id, texts[i]));
    }
    return out;
  }, [matches, idx]);

  return (
    <section className="results" aria-labelledby="h-results">
      <h3 id="h-results" className="sub-h" ref={head}>
        <span className="nowrap">Results for <span className="num">{targetText(r)}</span></span>
        {matches.length > 0 && <span className="count">{plural(matches.length, 'match', 'matches')} · ↑ ↓ to move · hover a number to see it elsewhere</span>}
        {matches.length > 1 && (
          <span className="push line sort-pick" title={SORT_HINT}>
            <span className="label">Order</span>
            <Pick value={s.resultSort} label="Order of results" options={SORTS.map(k => ({ value: k, label: SORT_LABEL[k] }))} onChange={v => setResultSort(v as ResultSort)} />
          </span>
        )}
      </h3>
      <SearchNote run={r} readOnly={readOnly} />
      {r.status === 'done' && !matches.length && <NotFound run={r} readOnly={readOnly} />}
      {pages > 1 && <Pager at={at} pages={pages} total={matches.length} onGo={goTo} />}
      {matches.length > 0 && (
        <div className="result-list" onKeyDown={arrowNav}>
          {shown.map(m => (
            <MatchRows
              key={m.items.map(i => `${i.sign < 0 ? '-' : ''}${i.id}`).join('+')}
              match={m} run={r} previewId={previewId} distinguish={distinguish}
            />
          ))}
        </div>
      )}
      {pages > 1 && <Pager at={at} pages={pages} total={matches.length} onGo={goTo} />}
    </section>
  );
}

/** "Matches 101–200 of 4,312" with the way back and forward. Only shown when there is more than one page. */
function Pager({ at, pages, total, onGo }: { at: number; pages: number; total: number; onGo: (page: number) => void }) {
  const from = at * PAGE_SIZE + 1;
  const to = Math.min(total, (at + 1) * PAGE_SIZE);
  return (
    <div className="pager" role="navigation" aria-label="Pages of results">
      <button type="button" className="btn sm" disabled={at === 0} onClick={() => onGo(at - 1)}>
        <IconChevronLeft size={12} aria-hidden /> Previous
      </button>
      <span className="muted">
        Matches {from.toLocaleString('en-US')}–{to.toLocaleString('en-US')} of {total.toLocaleString('en-US')} · page {at + 1} of {pages.toLocaleString('en-US')}
      </span>
      <button type="button" className="btn sm" disabled={at >= pages - 1} onClick={() => onGo(at + 1)}>
        Next <IconChevronRight size={12} aria-hidden />
      </button>
    </div>
  );
}

/**
 * While a search runs: how long it has run, its limit, matches so far, and Stop. After it stops early (time
 * limit, Stop, or the match cap): why, a "Search again for longer" button, and ways to narrow it.
 * Retrying makes a new version of the same search.
 */
function SearchNote({ run: r, readOnly }: { run: SearchRun; readOnly: boolean }) {
  const sums = r.settings.maxCount !== 1 && !r.range;
  const limit = searchSecondsOf(r.settings);
  if (r.status === 'running') {
    const limitText = !sums ? '' : limit === null ? ' · no time limit' : ` of ${secondsLabel(limit)}`;
    return (
      <div className="search-note running" role="status">
        <IconLoader2 className="spin" size={14} aria-hidden />
        <span>Searching · {elapsedLabel(r.elapsedMs)}{limitText}{r.matches.length > 0 && ` · ${plural(r.matches.length, 'match', 'matches')} so far`}</span>
        {!readOnly && (
          <button type="button" className="btn sm push" onClick={() => stopRun(r.id)}><IconPlayerStop size={12} aria-hidden /> Stop</button>
        )}
      </div>
    );
  }
  if (r.status !== 'done' || !sums || (r.reason !== 'timeLimit' && r.reason !== 'stopped' && r.reason !== 'maxResults')) return null;
  const longer = r.reason === 'maxResults' ? undefined : longerSeconds(limit);
  const why = r.reason === 'maxResults'
    ? `Stopped after the first ${SUM_MAX_RESULTS.toLocaleString('en-US')} matches, so there may be others.`
    : r.reason === 'stopped'
      ? `Stopped after ${elapsedLabel(r.elapsedMs)}, before trying every combination.`
      : `Stopped at the ${secondsLabel(limit ?? 0)} time limit, before trying every combination.`;
  return (
    <div className="search-note" role="status">
      <IconClock size={14} aria-hidden />
      <span>{why} {r.reason === 'maxResults' ? 'Narrowing the search shows the rest:' : 'Give it longer, or narrow it:'}</span>
      {!readOnly && (
        <span className="line">
          {longer !== undefined && (
            <button type="button" className="btn sm" title="Runs as a new version of this search" onClick={() => retryWith(r.id, { seconds: longer })}>
              <IconSearch size={12} aria-hidden /> Search again {longer === null ? 'with no limit' : `for ${secondsLabel(longer)}`}
            </button>
          )}
          <NarrowChips settings={r.settings} onApply={patch => retryWith(r.id, patch)} />
        </span>
      )}
    </div>
  );
}

/** A sum: a title line, the equation along the bottom (trimmed to … with the total always visible), and the rows when opened. */
function MatchRows({ match, run, previewId, distinguish }: { match: Match; run: SearchRun; previewId: string | null; distinguish?: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  if (match.items.length === 1) return <ItemRow item={match.items[0]} match={match} run={run} previewId={previewId} />;
  const holdsSelected = match.items.some(it => it.id === previewId);
  return (
    <div className={`combo${open ? ' open' : ''}${holdsSelected ? ' has-selected' : ''}`}>
      <button type="button" className="combo-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="combo-title" title={sumTitle(match)}>{sumTitle(match)}</span>
        <IconChevronDown size={16} className="chev" aria-hidden />
        <Equation match={match} withFiles={false} layout="row" distinguish={distinguish} />
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
  const candidates = scopeAmounts(s, r.settings.scope)
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
      {r.reason === 'timeLimit' || r.reason === 'stopped' ? (
        <p><b>Nothing found before it stopped.</b> Not every sum in {scopePhrase(s, r.settings.scope)} was tried yet{filters && ` (${filters})`}, so a match may still exist.</p>
      ) : (
      <p><b>Not found.</b> {r.range ? `No number in ${scopePhrase(s, r.settings.scope)} falls between ${targetText(r).replace('..', ' and ')}` : `Nothing in ${scopePhrase(s, r.settings.scope)} makes ${formatMoney(r.target, r.targetDecimals)}${how}`}{filters && ` (${filters})`}.</p>
      )}
      {near
        ? <NearButton near={near} target={r.target} decimals={r.targetDecimals} onShow={showPreview} />
        : !r.range && <p className="muted">Nothing in {scopePhrase(s, r.settings.scope)} is close to it either.</p>}
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
