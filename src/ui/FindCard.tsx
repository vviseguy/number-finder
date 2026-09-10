import { IconListCheck } from '@tabler/icons-react';
import { ALL_FILES, openCheckSetup, runSearch, setFind, setFindText, useAppState } from '../state/store';
import { MADE_OF_OPTIONS, ROUNDING_LABEL } from '../lib/format';
import type { Rounding } from '../types';
import { Segmented } from './common';

export function FindCard() {
  const s = useAppState();
  const f = s.find;
  const groupId = f.groupId === ALL_FILES || s.groups.some(g => g.id === f.groupId) ? f.groupId : ALL_FILES;

  return (
    <section className="card find-card" aria-labelledby="h-find">
      <h2 id="h-find" className="step-h"><span className="step">3</span> Find a number</h2>
      <form
        onSubmit={e => { e.preventDefault(); if (runSearch(s.findText)) setFindText(''); }}
        className="find-form"
      >
        <div className="line">
          <label htmlFor="find-input" className="sentence">Find what makes</label>
          <input
            id="find-input"
            className="amount-input"
            inputMode="decimal"
            autoComplete="off"
            placeholder="3,235"
            value={s.findText}
            onChange={e => setFindText(e.target.value)}
          />
          <span className="sentence">in</span>
          <select value={groupId} onChange={e => setFind({ groupId: e.target.value })} aria-label="Group to search">
            <option value={ALL_FILES}>All files</option>
            {s.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <button type="submit" className="btn primary">Find</button>
          <kbd>Enter</kbd>
        </div>
        <div className="line">
          <span className="sentence">Match with</span>
          <Segmented label="How many numbers may add up to it" options={MADE_OF_OPTIONS} value={f.maxCount} onChange={maxCount => setFind({ maxCount })} />
          <label className="inline">
            <span className="sentence">Rounding</span>
            <select value={f.rounding} onChange={e => setFind({ rounding: e.target.value as Rounding })}>
              {(Object.keys(ROUNDING_LABEL) as Rounding[]).map(r => <option key={r} value={r}>{ROUNDING_LABEL[r]}</option>)}
            </select>
          </label>
          <label className="inline check" title="Let any number count as negative, e.g. a penalty that reduces interest">
            <input type="checkbox" checked={f.allowFlips} onChange={e => setFind({ allowFlips: e.target.checked })} /> Also try negatives
          </label>
        </div>
        <p className="hint line">
          Click any number in a preview to search for it. To trace every number in a group at once,
          <button type="button" className="btn sm" onClick={() => openCheckSetup(!s.checkSetupOpen)} aria-expanded={s.checkSetupOpen}>
            <IconListCheck size={13} aria-hidden /> Check a group
          </button>
        </p>
      </form>
    </section>
  );
}
