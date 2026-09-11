import { useEffect, useRef } from 'react';
import { IconPencil, IconSearch, IconX } from '@tabler/icons-react';
import { addFiles, ALL_FILES, cancelEdit, clearFindText, groupById, setFind, setFindText, setScope, submitFind, useAppState } from '../state/store';
import { formatMoney, madeOfLabel, MADE_OF_HINT, MATCH_CHOICES, ROUNDING_LABEL } from '../lib/format';
import { parseQuery, termsSentence } from '../lib/query';
import type { Rounding } from '../types';

const ACCEPT = '.pdf,.xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt';

export function chooseFiles() { document.getElementById('file-input')?.click(); }

/**
 * The search bar under the header, on every view. Reads as a sentence:
 *   Find [a number ▾]  [3,235 -hours]  in [All files ▾]
 *   Find [every number in 2025 return ▾]  [filters]  against [Source docs ▾]
 * The query stays in the bar after searching; selecting a search in the list loads it back.
 */
export function FindBar() {
  const s = useAppState();
  const f = s.find;
  const groupId = f.groupId === ALL_FILES || groupById(s, f.groupId) ? f.groupId : ALL_FILES;
  const scope = groupById(s, s.scopeGroupId);
  const editing = s.runs.find(r => r.id === s.editingRunId);
  const input = useRef<HTMLInputElement>(null);
  const q = parseQuery(s.findText);
  const numbers = q.value === null ? 0 : 1 + q.extraNumbers.length;
  const echo = scope && q.value !== null
    ? `"Every number in ${scope.name}" is picked, so the words here are filters. Choose "a number" to search for ${q.valueText}.`
    : [numbers > 1 ? `${numbers} numbers: each starts its own search.` : '', termsSentence(q.terms)].filter(Boolean).join(' ');

  useEffect(() => { if (s.editingRunId) input.current?.focus(); }, [s.editingRunId]);

  return (
    <section className="strip" aria-label="Find a number">
      {editing && (
        <p className="editing-banner">
          <IconPencil size={13} aria-hidden /> Editing {editing.kind === 'search' ? `the search for ${formatMoney(editing.target, editing.targetDecimals)}` : 'this check'} · pressing {scope ? 'Check' : 'Find'} replaces it and keeps version {editing.version}.
          <button type="button" className="link" onClick={cancelEdit}>Cancel</button>
        </p>
      )}
      <form className="searchbar" onSubmit={e => { e.preventDefault(); submitFind(); }}>
        <label className="what">
          <span className="sentence">Find</span>
          <select value={s.scopeGroupId ?? 'number'} aria-label="What to find" onChange={e => setScope(e.target.value === 'number' ? null : e.target.value)}>
            <option value="number">a number</option>
            {s.groups.map(g => <option key={g.id} value={g.id}>every number in {g.name}</option>)}
          </select>
        </label>
        <div className="query">
          <IconSearch size={17} stroke={1.75} className="query-icon" aria-hidden />
          <input
            id="find-input"
            ref={input}
            autoComplete="off"
            spellCheck={false}
            placeholder={scope ? 'Filters, like -hours (optional)' : 'A number, like 3,235 — or several'}
            value={s.findText}
            onChange={e => setFindText(e.target.value)}
          />
          {s.findText && (
            <button type="button" className="icon-btn clear" aria-label="Clear" title="Clear" onClick={() => { clearFindText(); input.current?.focus(); }}>
              <IconX size={14} />
            </button>
          )}
        </div>
        <label className="where">
          <span className="sentence">{scope ? 'against' : 'in'}</span>
          <select value={groupId} onChange={e => setFind({ groupId: e.target.value })} aria-label="Group to search">
            <option value={ALL_FILES}>All files</option>
            {s.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <button type="submit" className="btn primary go">{editing ? (scope ? 'Check again' : 'Find again') : scope ? 'Check' : 'Find'}</button>
      </form>
      {echo && <p className="query-echo" role="status">{echo}</p>}
      <div className="opts">
        <label className="opt" title={MADE_OF_HINT}>
          <span>Match</span>
          <select value={f.maxCount === null ? 'any' : String(f.maxCount)} aria-label="Match" onChange={e => setFind({ maxCount: e.target.value === 'any' ? null : Number(e.target.value) })}>
            {MATCH_CHOICES.map(c => <option key={String(c)} value={c === null ? 'any' : String(c)}>{madeOfLabel(c)}</option>)}
          </select>
        </label>
        <label className="opt">
          <span>Rounding</span>
          <select value={f.rounding} aria-label="Rounding" onChange={e => setFind({ rounding: e.target.value as Rounding })}>
            {(Object.keys(ROUNDING_LABEL) as Rounding[]).map(r => <option key={r} value={r}>{ROUNDING_LABEL[r]}</option>)}
          </select>
        </label>
        <label className="opt" title="Let any number count as negative, e.g. a penalty that reduces interest">
          <span>Negatives</span>
          <select value={f.allowFlips ? 'on' : 'off'} aria-label="Negatives" onChange={e => setFind({ allowFlips: e.target.value === 'on' })}>
            <option value="off">off</option>
            <option value="on">also try negatives</option>
          </select>
        </label>
        <span className="hint push">Add a word to search only numbers labeled with it, or <b>-word</b> to skip them, like <b>-hours</b>.</span>
      </div>
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
