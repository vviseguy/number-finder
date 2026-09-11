import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconSearch, IconX } from '@tabler/icons-react';
import { addFiles, ALL_FILES, clearFindText, groupById, groupByText, groupName, loadSetupFile, setFind, setFindText, submitFind, useAppState } from '../state/store';
import { MADE_OF_HINT, MAX_SUM_SIZE, MIN_SUM_SIZE, ROUNDING_LABEL, ROUNDING_SHORT } from '../lib/format';
import { checkToken, foldPlusMinus, parseQuery, termsSentence } from '../lib/query';
import type { Rounding } from '../types';
import { Pick } from './Pick';

const ACCEPT = '.pdf,.xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt,.json';

export function chooseFiles() { document.getElementById('file-input')?.click(); }
export function chooseSetup() { document.getElementById('setup-input')?.click(); }

/** Shown in turn in the empty bar: each one is something you can type. Group names are filled in when there are groups. */
function hints(groups: string[]): string[] {
  const g = groups[0] ?? 'Source docs';
  const g2 = groups[1] ?? groups[0] ?? '2025 return';
  return [
    '3,235',
    '3,235 -hours  ·  skip numbers labeled “hours”',
    '3,234.56 interest  ·  only numbers labeled “interest”',
    '3,235 "box 1"  ·  quotes: must say exactly this',
    '3,235 ~intrest  ·  ~ allows a small typo',
    "3,235 '2025  ·  ' reads 2025 as text and lists those numbers first",
    '3,235 85,000  ·  two numbers, two searches',
    '3,200..3,300  ·  every number in a range',
    '3,235 sums:3  ·  sums of up to 3 numbers',
    '3,235 ±0.50  ·  within 50 cents (type +-)',
    '3,235 neg  ·  let numbers count as negative',
    `3,235 in:${/\s/.test(g) ? `"${g}"` : g}  ·  look in a group by name`,
    `${checkToken(g2)}  ·  look up every number in a group`,
  ];
}

/**
 * The search bar under the header, on every view:
 *   [🔍 3,235 -hours]  in [All files ▾]  (Search)
 * `check:"2025 return"` in the bar looks up every number in that group; the right side then reads
 * "against". The query stays in the bar after searching; selecting a search in the history loads it back.
 */
export function FindBar() {
  const s = useAppState();
  const f = s.find;
  const groupId = f.groupId === ALL_FILES || groupById(s, f.groupId) ? f.groupId : ALL_FILES;
  const input = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [hint, setHint] = useState(0);
  const [focused, setFocused] = useState(false);
  const groupNames = s.groups.map(g => g.name);
  const HINTS = useMemo(() => hints(groupNames), [groupNames.join('\n')]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = parseQuery(s.findText);
  const checking = q.checkGroup !== null;
  const checkId = checking ? groupByText(s, q.checkGroup!) : undefined;
  const echo = q.errors[0]
    ?? (checking
      ? (!checkId || checkId === ALL_FILES
        ? `No group is called “${q.checkGroup}”. ${s.groups.length ? `Groups: ${groupNames.join(', ')}.` : 'Make one in step 2.'}`
        : q.numbers.length || q.range
          ? `check: looks up every number in ${groupName(s, checkId)}, so leave the numbers out — or take check: away to search for ${q.numbers[0]?.text ?? q.range?.text}.`
          : `Every number in ${groupName(s, checkId)} will be looked up against ${groupName(s, q.inGroup ? groupByText(s, q.inGroup) ?? groupId : groupId)}. ${termsSentence(q.terms)}`.trim())
      : [q.numbers.length > 1 ? `${q.numbers.length} numbers: each is its own search.` : '', termsSentence(q.terms)].filter(Boolean).join(' '));
  const echoBad = q.errors.length > 0 || (checking && (!checkId || checkId === ALL_FILES || q.numbers.length > 0 || !!q.range));

  // A new search (title or step 3 clicked, or Search on an empty bar) puts the cursor in the bar.
  useEffect(() => { if (s.barFocus) input.current?.focus(); }, [s.barFocus]);

  // After "+-" was folded into "±", put the caret back where it was.
  useLayoutEffect(() => {
    if (pendingCaret.current === null || !input.current) return;
    input.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  // Rotate the hints while the bar is empty and not being typed in.
  useEffect(() => {
    if (s.findText || focused) return;
    const t = setInterval(() => setHint(h => (h + 1) % HINTS.length), 4000);
    return () => clearInterval(t);
  }, [s.findText, focused, HINTS.length]);

  const sums = typeof f.maxCount === 'number' && f.maxCount > 1;
  const [sumSize, setSumSize] = useState(sums ? f.maxCount as number : 3);
  useEffect(() => { if (typeof f.maxCount === 'number' && f.maxCount > 1) setSumSize(f.maxCount); }, [f.maxCount]);

  return (
    <section className="strip" aria-label="Search">
      <form className="searchbar" onSubmit={e => { e.preventDefault(); submitFind(); }}>
        <div className="query">
          <IconSearch size={18} stroke={1.75} className="query-icon" aria-hidden />
          <input
            id="find-input"
            ref={input}
            autoComplete="off"
            spellCheck={false}
            placeholder={HINTS[hint % HINTS.length]}
            value={s.findText}
            onChange={e => {
              const folded = foldPlusMinus(e.target.value, e.target.selectionStart ?? e.target.value.length);
              if (folded) { pendingCaret.current = folded.caret; setFindText(folded.text); } else setFindText(e.target.value);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          {s.findText && (
            <button type="button" className="icon-btn clear" aria-label="Clear" title="Clear" onClick={() => { clearFindText(); input.current?.focus(); }}>
              <IconX size={14} />
            </button>
          )}
        </div>
        <span className="where" title={checking ? 'The group the numbers are looked up in' : 'The group to search in'}>
          <span className="sentence">{checking ? 'against' : 'in'}</span>
          <Pick
            value={groupId}
            label="Group to search"
            options={[{ value: ALL_FILES, label: 'All files' }, ...s.groups.map(g => ({ value: g.id, label: g.name }))]}
            onChange={v => setFind({ groupId: v })}
          />
        </span>
        <button type="submit" className="go">Search</button>
      </form>
      {echo && <p className={`query-echo${echoBad ? ' bad' : ''}`} role="status">{echo}</p>}
      {/* Each pill is one dropdown: a click anywhere on it opens the list (the select is stretched over the pill). */}
      <div className="opts">
        <span className="opt" title={MADE_OF_HINT}>
          <span className="opt-name">Match</span>
          <Pick
            value={f.maxCount === 1 ? '1' : f.maxCount === null ? 'any' : 'sums'}
            label="Match"
            options={[{ value: '1', label: '1 number' }, { value: 'sums', label: 'Sums of up to' }, { value: 'any', label: 'Any sum' }]}
            onChange={v => setFind({ maxCount: v === '1' ? 1 : v === 'any' ? null : sumSize })}
          >
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
          </Pick>
        </span>
        <span className="opt" title="How close a match has to be">
          <span className="opt-name">Rounding</span>
          <Pick
            value={f.rounding}
            label="Rounding"
            options={(Object.keys(ROUNDING_LABEL) as Rounding[]).map(r => ({ value: r, label: ROUNDING_LABEL[r], short: ROUNDING_SHORT[r] }))}
            onChange={v => setFind({ rounding: v as Rounding, tolerance: undefined })}
          />
        </span>
        <span className="opt" title="Let any number count as negative, e.g. a penalty that reduces interest">
          <span className="opt-name">Negatives</span>
          <Pick
            value={f.allowFlips ? 'on' : 'off'}
            label="Negatives"
            options={[{ value: 'off', label: 'off' }, { value: 'on', label: 'also try negatives', short: 'on' }]}
            onChange={v => setFind({ allowFlips: v === 'on' })}
          />
        </span>
      </div>
      <input
        id="file-input"
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) void addFiles(files); }}
      />
      <input
        id="setup-input"
        type="file"
        accept=".json,application/json"
        hidden
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadSetupFile(f); }}
      />
    </section>
  );
}
