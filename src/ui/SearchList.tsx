import { IconCheck, IconPlayerPlay, IconPlayerStop, IconRefresh, IconX } from '@tabler/icons-react';
import { clearFinished, removeSearch, rerunSearch, selectSearch, settingsSummary, stopSearch, useAppState, type SearchRun } from '../state/store';
import { formatMoney, plural } from '../lib/format';
import { arrowNav } from './common';

export function SearchList() {
  const s = useAppState();
  if (!s.searches.length) return null;
  const running = s.searches.filter(r => r.status === 'running').length;
  const finished = s.searches.length - running;

  return (
    <section className="searches" aria-labelledby="h-searches">
      <h3 id="h-searches" className="sub-h">
        Searches
        <span className="count">{[running && `${running} running`, finished && `${finished} done`].filter(Boolean).join(' · ')}</span>
        {finished > 0 && <button type="button" className="link push" onClick={clearFinished}>Clear finished</button>}
      </h3>
      <ul className="search-list" onKeyDown={arrowNav}>
        {s.searches.map(r => (
          <li key={r.id} className={`search-row${r.id === s.selectedSearchId ? ' selected' : ''}`}>
            <button type="button" data-nav className="search-main" aria-current={r.id === s.selectedSearchId} onClick={() => selectSearch(r.id)}>
              <span className="target num">{formatMoney(r.target, r.targetDecimals)}</span>
              <span className="meta">{settingsSummary(s, r.settings)}</span>
              {r.status === 'running' && (
                <span className="bar" role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.progress === null ? undefined : Math.round(r.progress * 100)}>
                  <span className={r.progress === null ? 'indeterminate' : ''} style={r.progress === null ? undefined : { width: `${Math.round(r.progress * 100)}%` }} />
                </span>
              )}
            </button>
            <Status run={r} />
            <button type="button" className="icon-btn" aria-label="Remove search" title="Remove" onClick={() => removeSearch(r.id)}>
              <IconX size={13} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Status({ run: r }: { run: SearchRun }) {
  if (r.status === 'idle') {
    return (
      <span className="status">
        <span className="muted">Not run yet</span>
        <button type="button" className="btn sm" onClick={() => rerunSearch(r.id)}><IconPlayerPlay size={12} aria-hidden /> Run</button>
      </span>
    );
  }
  if (r.status === 'running') {
    const pct = r.progress === null ? `${(r.elapsedMs / 1000).toFixed(1)} s` : `${Math.round(r.progress * 100)}%`;
    return (
      <span className="status accent">
        Running · {pct}
        <button type="button" className="btn sm" onClick={() => stopSearch(r.id)}><IconPlayerStop size={12} aria-hidden /> Stop</button>
      </span>
    );
  }
  const n = r.matches.length;
  if (r.reason === 'invalid') return <span className="status danger" title={r.detail}>Couldn't run</span>;
  if (!n) {
    return (
      <span className="status danger">
        {r.reason === 'stopped' ? 'Stopped · none found' : 'Not found'}
        <button type="button" className="icon-btn" aria-label="Run again" title="Run again" onClick={() => rerunSearch(r.id)}><IconRefresh size={13} /></button>
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
