import { useEffect, useRef, useState } from 'react';
import { IconSearch, IconX } from '@tabler/icons-react';
import { addFiles, ALL_FILES, clearFindText, groupById, setFind, setFindText, setScope, submitFind, useAppState } from '../state/store';
import { MADE_OF_HINT, MAX_SUM_SIZE, MIN_SUM_SIZE, ROUNDING_LABEL } from '../lib/format';
import { parseQuery, termsSentence } from '../lib/query';
import type { Rounding } from '../types';

const ACCEPT = '.pdf,.xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt';

export function chooseFiles() { document.getElementById('file-input')?.click(); }

/** Shown in turn in the empty bar: each one is something you can type. */
const HINTS = [
  '3,235',
  '3,235 -hours  ·  skip numbers labeled “hours”',
  '3,234.56 interest  ·  only numbers labeled “interest”',
  '3,235 85,000  ·  two numbers, two searches',
  '3,200..3,300  ·  every number in a range',
  '3,235 sums:3  ·  sums of up to 3 numbers',
  '3,235 ±0.50  ·  within 50 cents',
  '3,235 neg  ·  let numbers count as negative',
  '3,235 in:Source  ·  look in a group by name',
  '-"hourly rate"  ·  quotes keep a phrase together',
];

/**
 * The search bar under the header, on every view. One number mode:
 *   [One number | Whole group]  [🔍 3,235 -hours]  in [All files ▾]  (Search)
 * Whole-group mode looks up every number in a group:
 *   [One number | Whole group]  Every number in [2025 return ▾]  [🔍 filters]  against [Source docs ▾]  (Search)
 * The query stays in the bar after searching; selecting a search in the history loads it back.
 */
export function FindBar() {
  const s = useAppState();
  const f = s.find;
  const groupId = f.groupId === ALL_FILES || groupById(s, f.groupId) ? f.groupId : ALL_FILES;
  const scope = groupById(s, s.scopeGroupId);
  const whole = s.scopeGroupId !== null;
  const input = useRef<HTMLInputElement>(null);
  const [hint, setHint] = useState(0);
  const [focused, setFocused] = useState(false);
  const q = parseQuery(s.findText);
  const echo = q.errors[0]
    ?? (whole && (q.numbers.length || q.range)
      ? `Whole-group mode looks up every number in ${scope?.name ?? 'the group'}; the words here are filters. Switch to One number to search for ${q.numbers[0]?.text ?? q.range?.text}.`
      : [q.numbers.length > 1 ? `${q.numbers.length} numbers: each is its own search.` : '', termsSentence(q.terms)].filter(Boolean).join(' '));

  // A new search (title or step 3 clicked, or Search on an empty bar) puts the cursor in the bar.
  useEffect(() => { if (s.barFocus) input.current?.focus(); }, [s.barFocus]);

  // Rotate the hints while the bar is empty and not being typed in.
  useEffect(() => {
    if (s.findText || focused) return;
    const t = setInterval(() => setHint(h => (h + 1) % HINTS.length), 4000);
    return () => clearInterval(t);
  }, [s.findText, focused]);

  const sums = typeof f.maxCount === 'number' && f.maxCount > 1;
  const [sumSize, setSumSize] = useState(sums ? f.maxCount as number : 3);
  useEffect(() => { if (typeof f.maxCount === 'number' && f.maxCount > 1) setSumSize(f.maxCount); }, [f.maxCount]);

  return (
    <section className="strip" aria-label="Search">
      <form className="searchbar" onSubmit={e => { e.preventDefault(); submitFind(); }}>
        <span className="mode" role="radiogroup" aria-label="What to find">
          <button type="button" role="radio" aria-checked={!whole} className={!whole ? 'on' : ''} onClick={() => setScope(null)}>One number</button>
          <button type="button" role="radio" aria-checked={whole} className={whole ? 'on' : ''} onClick={() => setScope(s.scopeGroupId ?? s.groups.find(g => g.id !== groupId)?.id ?? s.groups[0]?.id ?? null)} disabled={!s.groups.length} title={s.groups.length ? 'Look up every number in a group' : 'Make a group first (step 2)'}>
            Whole group
          </button>
        </span>
        {whole && (
          <label className="every">
            <span className="sentence">Every number in</span>
            <select value={s.scopeGroupId ?? ''} aria-label="Group to check" onChange={e => setScope(e.target.value)}>
              {s.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}
        <div className="query">
          <IconSearch size={17} stroke={1.75} className="query-icon" aria-hidden />
          <input
            id="find-input"
            ref={input}
            autoComplete="off"
            spellCheck={false}
            placeholder={whole ? 'Filters, like -hours (optional)' : HINTS[hint]}
            value={s.findText}
            onChange={e => setFindText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          {s.findText && (
            <button type="button" className="icon-btn clear" aria-label="Clear" title="Clear" onClick={() => { clearFindText(); input.current?.focus(); }}>
              <IconX size={14} />
            </button>
          )}
        </div>
        <label className="where">
          <span className="sentence">{whole ? 'against' : 'in'}</span>
          <select value={groupId} onChange={e => setFind({ groupId: e.target.value })} aria-label="Group to search">
            <option value={ALL_FILES}>All files</option>
            {s.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <button type="submit" className="btn primary go">Search</button>
      </form>
      {echo && <p className={`query-echo${q.errors.length ? ' bad' : ''}`} role="status">{echo}</p>}
      <div className="opts">
        <label className="opt" title={MADE_OF_HINT}>
          <span>Match</span>
          <select
            value={f.maxCount === 1 ? '1' : f.maxCount === null ? 'any' : 'sums'}
            aria-label="Match"
            onChange={e => setFind({ maxCount: e.target.value === '1' ? 1 : e.target.value === 'any' ? null : sumSize })}
          >
            <option value="1">1 number</option>
            <option value="sums">Sums of up to</option>
            <option value="any">Any sum</option>
          </select>
          {sums && (
            <input
              type="number"
              className="sum-size"
              min={MIN_SUM_SIZE}
              max={MAX_SUM_SIZE}
              step={1}
              value={sumSize}
              aria-label="Most numbers in a sum"
              onChange={e => {
                const n = Number(e.target.value);
                setSumSize(n);
                if (Number.isInteger(n) && n >= MIN_SUM_SIZE && n <= MAX_SUM_SIZE) setFind({ maxCount: n });
              }}
            />
          )}
        </label>
        <label className="opt">
          <span>Rounding</span>
          <select value={f.rounding} aria-label="Rounding" onChange={e => setFind({ rounding: e.target.value as Rounding, tolerance: undefined })}>
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
