import { useState } from 'react';
import { IconPlus } from '@tabler/icons-react';
import { ALL_FILES, createGroup, openCheckSetup, startCheck, useAppState } from '../state/store';
import { MADE_OF_OPTIONS, ROUNDING_LABEL } from '../lib/format';
import type { Rounding } from '../types';
import { Segmented } from './common';

export function CheckSetup() {
  const s = useAppState();
  const firstOther = s.groups.find(g => g.id !== s.find.groupId)?.id ?? s.groups[0]?.id ?? '';
  const [checkId, setCheckId] = useState(firstOther);
  const [againstId, setAgainstId] = useState(s.find.groupId !== checkId ? s.find.groupId : ALL_FILES);
  const [maxCount, setMaxCount] = useState<number | null>(s.find.maxCount === 1 ? 3 : s.find.maxCount);
  const [rounding, setRounding] = useState<Rounding>(s.find.rounding);
  const [allowFlips, setAllowFlips] = useState(s.find.allowFlips);

  if (!s.groups.length) {
    return (
      <section className="card check-setup" aria-label="Check a group">
        <h3>Check a group</h3>
        <p className="muted">
          Make a group first. For example, put your return in one group and your source documents in another, then check the return against the sources.
        </p>
        <div className="line">
          <button type="button" className="btn" onClick={() => createGroup('2025 return')}><IconPlus size={13} aria-hidden /> Add a group</button>
          <button type="button" className="btn ghost" onClick={() => openCheckSetup(false)}>Cancel</button>
        </div>
      </section>
    );
  }

  const same = checkId === againstId;
  return (
    <section className="card check-setup" aria-label="Check a group">
      <h3>Check a group</h3>
      <p className="muted">Every number in the first group is looked up in the second. You get a list of what was found, what's made of several numbers, and what's missing.</p>
      <div className="line">
        <span className="sentence">Check</span>
        <select value={checkId} onChange={e => setCheckId(e.target.value)} aria-label="Group to check">
          {s.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <span className="sentence">against</span>
        <select value={againstId} onChange={e => setAgainstId(e.target.value)} aria-label="Group to look in">
          <option value={ALL_FILES}>All files</option>
          {s.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      <div className="line">
        <span className="sentence">Match with</span>
        <Segmented label="How many numbers may add up to each one" options={MADE_OF_OPTIONS} value={maxCount} onChange={setMaxCount} />
        <label className="inline">
          <span className="sentence">Rounding</span>
          <select value={rounding} onChange={e => setRounding(e.target.value as Rounding)}>
            {(Object.keys(ROUNDING_LABEL) as Rounding[]).map(r => <option key={r} value={r}>{ROUNDING_LABEL[r]}</option>)}
          </select>
        </label>
        <label className="inline check"><input type="checkbox" checked={allowFlips} onChange={e => setAllowFlips(e.target.checked)} /> Also try negatives</label>
      </div>
      {same && <p className="warn-line">A group checked against itself finds every number in itself. Pick a different group to look in.</p>}
      <div className="line">
        <button type="button" className="btn primary" disabled={same || !checkId} onClick={() => startCheck(checkId, againstId, { maxCount, rounding, allowFlips })}>
          Start check
        </button>
        <button type="button" className="btn ghost" onClick={() => openCheckSetup(false)}>Cancel</button>
      </div>
    </section>
  );
}
