import { useEffect, useRef, useState } from 'react';
import { IconChevronDown, IconListCheck, IconPencil, IconUpload, IconX } from '@tabler/icons-react';
import {
  addFiles, ALL_FILES, cancelEdit, groupAmounts, groupById, setFind, setFindText, setScope, submitFind, useAppState,
} from '../state/store';
import { formatMoney, plural, ROUNDING_LABEL } from '../lib/format';
import { parseQuery, termsSentence } from '../lib/query';
import type { Rounding } from '../types';
import { MatchControl } from './common';

const ACCEPT = '.pdf,.xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt';

export function chooseFiles() { document.getElementById('file-input')?.click(); }

/**
 * The strip under the header, on every view: where files are dropped and where searches start.
 * Type a number (plus optional filter words like -hours), or pick a group with "Check a group" to look up
 * every number in it. Editing a run loads it here; submitting replaces it and keeps the old version.
 */
export function FindBar() {
  const s = useAppState();
  const f = s.find;
  const groupId = f.groupId === ALL_FILES || groupById(s, f.groupId) ? f.groupId : ALL_FILES;
  const scope = groupById(s, s.scopeGroupId);
  const editing = s.runs.find(r => r.id === s.editingRunId);
  const [menuOpen, setMenuOpen] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const q = parseQuery(s.findText);
  const echo = scope && q.value !== null
    ? `A group is picked, so ${q.valueText} will be ignored. Remove the group to search for one number.`
    : termsSentence(q.terms);

  useEffect(() => { if (s.editingRunId) input.current?.focus(); }, [s.editingRunId]);

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
    <section className="strip" aria-label="Add files and find a number">
      {editing && (
        <p className="editing-banner">
          <IconPencil size={13} aria-hidden /> Editing {editing.kind === 'search' ? `the search for ${formatMoney(editing.target, editing.targetDecimals)}` : 'this check'} · pressing {scope ? 'Check' : 'Find'} replaces it and keeps version {editing.version}.
          <button type="button" className="link" onClick={cancelEdit}>Cancel</button>
        </p>
      )}
      <form className="strip-form" onSubmit={e => { e.preventDefault(); submitFind(); }}>
        <div className="line strip-line">
          <span className="drop-chip">
            <IconUpload size={14} stroke={1.75} aria-hidden />
            <span>Drop files anywhere, or <button type="button" className="link" onClick={chooseFiles}>choose files</button></span>
          </span>
          <label htmlFor="find-input" className="sentence">Find what makes</label>
          <div className={`query-field${scope ? ' scoped' : ''}`} ref={field}>
            {scope && (
              <span className={`scope-chip gc${scope.color}`}>
                <IconListCheck size={13} aria-hidden /> <span className="chip-text">Every number in {scope.name}</span>
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
          <span className="inline">
            <span className="sentence">in</span>
            <select value={groupId} onChange={e => setFind({ groupId: e.target.value })} aria-label="Group to search">
              <option value={ALL_FILES}>All files</option>
              {s.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </span>
          <span className="inline">
            <button type="submit" className="btn primary">{editing ? (scope ? 'Check again' : 'Find again') : scope ? 'Check' : 'Find'}</button>
            <kbd>Enter</kbd>
          </span>
        </div>
        {echo && <p className="query-echo" role="status">{echo}</p>}
        <div className="line strip-options">
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
          <span className="hint push">Add a word to search only numbers labeled with it, or <b>-word</b> to skip them, like <b>-hours</b>.</span>
        </div>
      </form>
      <input
        id="file-input"
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) void addFiles(files); }}
      />
    </section>
  );
}
