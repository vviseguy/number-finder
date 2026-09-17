import { IconCheck, IconHistory, IconListCheck, IconPlayerStop, IconRefresh, IconX } from '@tabler/icons-react';
import {
  clearFinished, removeRun, rerunRun, runSummary, scopePhrase, selectRun, stopRun, targetText, useAppState, viewVersion,
  type CheckRun, type Run, type SearchRun,
} from '../state/store';
import { plural } from '../lib/format';
import { arrowNav } from './common';
import { formatTime } from './checkParts';

/** Every search and check, newest first. Selecting one loads it into the bar and shows its results. */
export function RunList() {
  const s = useAppState();
  if (!s.runs.length) return null;
  const running = s.runs.filter(r => r.status === 'running').length;
  const finished = s.runs.length - running;

  return (
    <section className="searches" aria-labelledby="h-history">
      <h3 id="h-history" className="sub-h">
        <span className="nowrap">History</span>
        <span className="count">{[running && `${running} running`, finished && `${finished} done`].filter(Boolean).join(' · ')}</span>
        {finished > 0 && <button type="button" className="link push" onClick={clearFinished}>Clear finished</button>}
      </h3>
      <ul className="search-list" onKeyDown={arrowNav}>
        {s.runs.map(r => (
          <li key={r.id} className={`search-row${r.id === s.selectedRunId ? ' selected' : ''}`}>
            <button type="button" data-nav className="search-main" aria-current={r.id === s.selectedRunId} onClick={() => selectRun(r.id)}>
              {r.kind === 'search'
                ? <span className="target num">{targetText(r)}</span>
                : (
                  <span className="target run-check">
                    <IconListCheck size={15} aria-hidden /> Every number in
                    <span className="files-chip">{scopePhrase(s, r.checkKeys)}</span>
                  </span>
                )}
              <span className="meta">{runSummary(s, r)}</span>
              {r.status === 'running' && <Progress run={r} />}
            </button>
            {r.history.length > 0 && <VersionPicker run={r} />}
            {r.kind === 'search' ? <SearchStatus run={r} /> : <CheckStatus run={r} />}
            <button type="button" className="icon-btn" aria-label="Remove from history" title="Remove" onClick={() => removeRun(r.id)}>
              <IconX size={13} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "v3 ▾": the current version plus every earlier one, newest first. */
export function VersionPicker({ run: r }: { run: Run }) {
  return (
    <span className="version-pick" title="Versions of this search">
      <IconHistory size={13} aria-hidden />
      <select autoComplete="off"
        aria-label="Version"
        value={r.viewing === null ? 'current' : String(r.viewing)}
        onChange={e => viewVersion(r.id, e.target.value === 'current' ? null : Number(e.target.value))}
      >
        <option value="current">v{r.version} · {formatTime(r.at)} (current)</option>
        {r.history.map((v, i) => <option key={i} value={i}>v{i + 1} · {formatTime(v.at)}</option>).reverse()}
      </select>
    </span>
  );
}

function Progress({ run }: { run: Run }) {
  const fraction = run.kind === 'search'
    ? run.progress
    : run.rows.length ? run.rows.filter(x => x.status !== 'pending').length / run.rows.length : 0;
  return (
    <span className="bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}>
      <span className={fraction === null ? 'indeterminate' : ''} style={fraction === null ? undefined : { width: `${Math.round(fraction * 100)}%` }} />
    </span>
  );
}

function SearchStatus({ run: r }: { run: SearchRun }) {
  if (r.status === 'running') {
    const pct = r.progress === null ? `${(r.elapsedMs / 1000).toFixed(1)} s` : `${Math.round(r.progress * 100)}%`;
    return (
      <span className="status accent">
        Running · {pct}
        <button type="button" className="btn sm" onClick={() => stopRun(r.id)}><IconPlayerStop size={12} aria-hidden /> Stop</button>
      </span>
    );
  }
  const n = r.matches.length;
  if (r.reason === 'invalid') return <span className="status danger" title={r.detail}>Couldn't run</span>;
  if (!n) {
    return (
      <span className="status danger">
        {r.reason === 'stopped' ? 'Stopped · none found' : r.reason === 'timeLimit' ? 'Out of time · none found' : 'Not found'}
        <button type="button" className="icon-btn" aria-label="Run again" title="Run again" onClick={() => rerunRun(r.id)}><IconRefresh size={13} /></button>
      </span>
    );
  }
  const partial = r.reason === 'timeLimit' || r.reason === 'stopped';
  return (
    <span className="status ok" title={partial ? 'Stopped before checking every combination' : undefined}>
      <IconCheck size={13} aria-hidden /> {partial ? `${plural(n, 'match', 'matches')} so far` : plural(n, 'match', 'matches')}
    </span>
  );
}

function CheckStatus({ run: r }: { run: CheckRun }) {
  const done = r.rows.filter(x => x.status !== 'pending').length;
  if (r.status === 'running') {
    return (
      <span className="status accent">
        Checking {done} of {r.rows.length}
        <button type="button" className="btn sm" onClick={() => stopRun(r.id)}><IconPlayerStop size={12} aria-hidden /> Stop</button>
      </span>
    );
  }
  const missing = r.rows.filter(x => x.status === 'notfound').length;
  return (
    <span className="status">
      {r.status === 'stopped' && <span className="muted">Stopped · </span>}
      {missing
        ? <span className="danger">{missing} not found</span>
        : <span className="ok"><IconCheck size={13} aria-hidden /> All found</span>}
      <span className="muted">&nbsp;of {r.rows.length}</span>
    </span>
  );
}
