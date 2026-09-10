import { useEffect, useRef, useState } from 'react';
import { IconChevronDown, IconListCheck, IconX } from '@tabler/icons-react';
import { ALL_FILES, groupAmounts, groupById, setFind, setFindText, setScope, submitFind, useAppState } from '../state/store';
import { plural, ROUNDING_LABEL } from '../lib/format';
import { parseQuery, termsSentence } from '../lib/query';
import type { Rounding } from '../types';
import { MatchControl } from './common';

/**
 * One box for both jobs. Type a number (plus optional filter words like -hours), or pick a group with
 * "Check a group" to look up every number in it. The same Match, Rounding, and negatives settings apply.
 */
export function FindCard() {
  const s = useAppState();
  const f = s.find;
  const groupId = f.groupId === ALL_FILES || groupById(s, f.groupId) ? f.groupId : ALL_FILES;
  const scope = groupById(s, s.scopeGroupId);
  const [menuOpen, setMenuOpen] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const q = parseQuery(s.findText);
  const echo = scope && q.value !== null
    ? `A group is picked, so ${q.valueText} will be ignored. Remove the group to search for one number.`
    : termsSentence(q.terms);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!field.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const pick = (id: string | null) => { setScope(id); setMenuOpen(false); input.current?.focus(); };

  return (
    <section className="card find-card" aria-labelledby="h-find">
      <h2 id="h-find" className="step-h"><span className="step">3</span> {scope ? 'Check a group' : 'Find a number'}</h2>
      <form className="find-form" onSubmit={e => { e.preventDefault(); submitFind(); }}>
        <div className="line">
          <label htmlFor="find-input" className="sentence">Find what makes</label>
          <div className={`query-field${scope ? ' scoped' : ''}`} ref={field}>
            {scope && (
              <span className={`scope-chip gc${scope.color}`}>
                <IconListCheck size={13} aria-hidden /> Every number in {scope.name}
                <button type="button" aria-label="Remove the group and search one number" title="Search one number instead" onClick={() => pick(null)}>
                  <IconX size={12} />
                </button>
              </span>
            )}
            <input
              id="find-input"
              ref={input}
              autoComplete="off"
              spellCheck={false}
              placeholder={scope ? 'Optional filters, like -hours' : 'A number, like 3,235'}
              value={s.findText}
              onChange={e => setFindText(e.target.value)}
            />
            <button type="button" className="scope-btn" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
              {scope ? 'Change group' : 'Check a group'} <IconChevronDown size={13} aria-hidden />
            </button>
            {menuOpen && (
              <div className="scope-menu" role="menu" aria-label="Check every number in a group">
                <p className="menu-label">Look up every number in…</p>
                {s.groups.map(g => (
                  <button key={g.id} type="button" role="menuitem" className={g.id === s.scopeGroupId ? 'current' : ''} onClick={() => pick(g.id)}>
                    <span className={`gtag gc${g.color}`}>{g.name}</span>
                    <span className="muted">{plural(groupAmounts(s, g.id).length, 'number')}</span>
                  </button>
                ))}
                {!s.groups.length && <p className="muted menu-empty">Make a group first (step 2) — for example, one for your return.</p>}
                {scope && <button type="button" role="menuitem" onClick={() => pick(null)}>One number instead</button>}
              </div>
            )}
          </div>
          <span className="sentence">in</span>
          <select value={groupId} onChange={e => setFind({ groupId: e.target.value })} aria-label="Group to search">
            <option value={ALL_FILES}>All files</option>
            {s.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <button type="submit" className="btn primary">{scope ? 'Check' : 'Find'}</button>
          <kbd>Enter</kbd>
        </div>
        {echo && <p className="query-echo" role="status">{echo}</p>}
        <div className="line">
          <span className="sentence">Match</span>
          <MatchControl label="How many numbers may add up to it" value={f.maxCount} onChange={maxCount => setFind({ maxCount })} />
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
        <p className="hint">
          Add a word to search only numbers labeled with it, or <b>-word</b> to skip them, like <b>-hours</b>. Click any number in a preview to search for it.
        </p>
      </form>
    </section>
  );
}
