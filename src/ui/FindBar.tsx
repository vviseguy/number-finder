import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconSearch, IconX } from '@tabler/icons-react';
import {
  addFiles, clearFindText, filesByText, keysOf, noFileMessage, scopePhrase, searchSecondsOf, setFind, setFindText, settingsFor, submitFind, useAppState,
} from '../state/store';
import {
  CHECK_SECONDS, DEFAULT_CHECK_SECONDS, MADE_OF_HINT, MAX_SUM_SIZE, MIN_SUM_SIZE, ROUNDING_LABEL, ROUNDING_SHORT, SEARCH_SECONDS, secondsLabel,
} from '../lib/format';
import { checkToken, foldPlusMinus, parseQuery, termsSentence } from '../lib/query';
import { GROUPING_HINT, GROUPING_LABEL, GROUPING_SHORT, GROUPINGS, groupingOf, type Grouping } from '../lib/rank';
import type { Rounding } from '../types';
import { Pick } from './Pick';
import { SizeNote } from './Narrow';
import { FilePicker } from './FilePicker';

const ACCEPT = '.pdf,.xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt';
const MAX_NEGATIVES = 20;

/** Shown in turn in the empty bar: each one is something you can type. The in: and check: examples use the files added. */
function hints(files: string[]): string[] {
  const token = (name: string) => (/\s/.test(name) ? `"${name}"` : name);
  const a = files[0] ?? '1099';
  const b = files[1] ?? files[0] ?? '1040';
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
    '3,235 sums:=3  ·  sums of exactly 3 numbers',
    '3,235 sums:3 mode:clumped  ·  sums of numbers next to each other',
    '3,235 sums:any time:5m  ·  let a big search run for 5 minutes',
    '3,235 ±0.50  ·  within 50 cents (type +-)',
    '3,235 neg  ·  let numbers count as negative',
    '3,235 neg:1  ·  at most one number counted as negative',
    `3,235 in:${token(a)}  ·  look only in the files named like that`,
    `${checkToken(b)}  ·  look up every number in a file against the other files`,
  ];
}

/** A small whole-number box inside a pill (the sum size, the most negatives). */
function CountBox({ value, min, max, label, onChange }: { value: number; min: number; max: number; label: string; onChange: (n: number) => void }) {
  return (
    <input autoComplete="off"
      type="number"
      className="sum-size"
      min={min}
      max={max}
      step={1}
      value={value}
      aria-label={label}
      onChange={e => onChange(Number(e.target.value))}
    />
  );
}

/**
 * Sums only. A search: "Time limit" (10 s … No limit). A check: "Time per number". A value typed in
 * the bar (time:45s) that isn't one of the choices is shown as its own choice.
 */
function TimePill({ checking }: { checking: boolean }) {
  const f = useAppState().find;
  if (checking) {
    const cur = f.checkSeconds ?? DEFAULT_CHECK_SECONDS;
    const choices = CHECK_SECONDS.includes(cur) ? CHECK_SECONDS : [...CHECK_SECONDS, cur].sort((a, b) => a - b);
    return (
      <span className="opt" title="A check searches each of its numbers in turn; this is how long each one may take">
        <span className="opt-name">Time per number</span>
        <Pick value={String(cur)} label="Time per number" options={choices.map(x => ({ value: String(x), label: secondsLabel(x) }))} onChange={v => setFind({ checkSeconds: Number(v) })} />
      </span>
    );
  }
  const cur = searchSecondsOf(f);
  const nums = SEARCH_SECONDS.filter((x): x is number => x !== null);
  const choices: (number | null)[] = cur === null || nums.includes(cur) ? SEARCH_SECONDS : [...[...nums, cur].sort((a, b) => a - b), null];
  return (
    <span className="opt" title="How long a sum search may run before it stops and shows what it found. With no limit it runs until it has tried everything, or until you press Stop.">
      <span className="opt-name">Time limit</span>
      <Pick
        value={cur === null ? 'none' : String(cur)}
        label="Time limit"
        options={choices.map(x => (x === null ? { value: 'none', label: 'No limit (until you stop it)', short: 'none' } : { value: String(x), label: secondsLabel(x) }))}
        onChange={v => setFind({ seconds: v === 'none' ? null : Number(v) })}
      />
    </span>
  );
}

/**
 * The search bar under the header:
 *   [🔍 3,235 -hours]  in [All files ▾]  (Search)
 * "in" is a checklist of the files (FilePicker). `check:1040` in the bar looks up every number in the files
 * named that way; the right side then reads "against". The query stays in the bar after searching;
 * selecting a search in the history loads it back.
 */
export function FindBar() {
  const s = useAppState();
  const f = s.find;
  const input = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [hint, setHint] = useState(0);
  const [focused, setFocused] = useState(false);
  const fileNames = s.files.map(x => x.name.replace(/\.[^.]+$/, ''));
  const HINTS = useMemo(() => hints(fileNames), [fileNames.join('\n')]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = parseQuery(s.findText);
  const checking = q.checkFiles.length > 0;
  const checkKeys = keysOf(q.checkFiles.flatMap(text => filesByText(s, text)));
  const unknown = [...q.inFiles, ...q.checkFiles].find(text => !filesByText(s, text).length);
  const scope = settingsFor(s, q).scope;
  const inWords = q.inFiles.length && unknown === undefined ? `Looking only in ${scopePhrase(s, scope)}.` : '';
  const echo = q.errors[0]
    ?? (unknown !== undefined ? noFileMessage(s, unknown)
      : checking
        ? (q.numbers.length || q.range
          ? `check: looks up every number in ${scopePhrase(s, checkKeys)}, so leave the numbers out — or take check: away to search for ${q.numbers[0]?.text ?? q.range?.text}.`
          : `Every number in ${scopePhrase(s, checkKeys)} will be looked up in ${scopePhrase(s, scope, checkKeys)}. ${termsSentence(q.terms)}`.trim())
        : [q.numbers.length > 1 ? `${q.numbers.length} numbers: each is its own search.` : '', inWords, termsSentence(q.terms)].filter(Boolean).join(' '));
  const echoBad = q.errors.length > 0 || unknown !== undefined || (checking && (q.numbers.length > 0 || !!q.range));

  // A new search (Search on an empty bar, or "Check every number" on a file) puts the cursor in the bar.
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

  // Match: 1 number · sums of up to N · sums of exactly N · any sum. The size box is shared by the two "sums of" choices.
  const sums = typeof f.maxCount === 'number' && f.maxCount > 1;
  const exact = sums && f.minCount === f.maxCount;
  const matchMode = f.maxCount === 1 ? '1' : f.maxCount === null ? 'any' : exact ? 'exact' : 'upto';
  const [sumSize, setSumSize] = useState(sums ? f.maxCount as number : 3);
  useEffect(() => { if (typeof f.maxCount === 'number' && f.maxCount > 1) setSumSize(f.maxCount); }, [f.maxCount]);
  const setMatch = (mode: string, n: number) => {
    if (mode === '1') setFind({ maxCount: 1, minCount: undefined });
    else if (mode === 'any') setFind({ maxCount: null, minCount: undefined });
    else if (mode === 'exact') setFind({ maxCount: n, minCount: n });
    else setFind({ maxCount: n, minCount: undefined });
  };

  // Negatives: off · on (any number of them) · up to N of them.
  const negMode = !f.allowFlips ? 'off' : f.maxFlips === undefined ? 'on' : 'upto';
  const [negSize, setNegSize] = useState(f.maxFlips ?? 1);
  useEffect(() => { if (f.maxFlips !== undefined) setNegSize(f.maxFlips); }, [f.maxFlips]);
  const setNegatives = (mode: string, n: number) => {
    if (mode === 'off') setFind({ allowFlips: false, maxFlips: undefined });
    else if (mode === 'on') setFind({ allowFlips: true, maxFlips: undefined });
    else setFind({ allowFlips: true, maxFlips: n });
  };

  return (
    <section className="strip" aria-label="Search">
      <form className="searchbar" onSubmit={e => { e.preventDefault(); submitFind(); }}>
        <div className="query">
          <IconSearch size={18} stroke={1.75} className="query-icon" aria-hidden />
          <input autoComplete="off"
            id="find-input"
            ref={input}
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
        <FilePicker checking={checkKeys} />
        <button type="submit" className="go">Search</button>
      </form>
      {echo && <p className={`query-echo${echoBad ? ' bad' : ''}`} role="status">{echo}</p>}
      {/* Each pill is one dropdown: a click anywhere on it opens the list (the select is stretched over the pill). */}
      <div className="opts">
        <span className="opt" title={MADE_OF_HINT}>
          <span className="opt-name">Match</span>
          <Pick
            value={matchMode}
            label="Match"
            options={[
              { value: '1', label: 'to number' },
              { value: 'any', label: 'to sum (Any count)', short: 'to sum · any count' },
              { value: 'upto', label: 'to sum (Up to count)', short: 'to sum · up to' },
              { value: 'exact', label: 'to sum (Specify count)', short: 'to sum · exactly' },
            ]}
            onChange={v => setMatch(v, sumSize)}
          >
            {sums && (
              <CountBox
                value={sumSize}
                min={MIN_SUM_SIZE}
                max={MAX_SUM_SIZE}
                label="Most numbers in a sum"
                onChange={n => { setSumSize(n); if (Number.isInteger(n) && n >= MIN_SUM_SIZE && n <= MAX_SUM_SIZE) setMatch(matchMode, n); }}
              />
            )}
          </Pick>
        </span>
        {f.maxCount !== 1 && (
          <span className="opt" title={GROUPING_HINT}>
            <span className="opt-name">Search mode</span>
            <Pick
              value={groupingOf(f)}
              label="Search mode"
              options={GROUPINGS.map(g => ({ value: g, label: GROUPING_LABEL[g], short: GROUPING_SHORT[g] }))}
              onChange={v => setFind({ grouping: v as Grouping })}
            />
          </span>
        )}
        {f.maxCount !== 1 && <TimePill checking={checking} />}
        <span className="opt" title="How close a match has to be">
          <span className="opt-name">Rounding</span>
          <Pick
            value={f.rounding}
            label="Rounding"
            options={(Object.keys(ROUNDING_LABEL) as Rounding[]).map(r => ({ value: r, label: ROUNDING_LABEL[r], short: ROUNDING_SHORT[r] }))}
            onChange={v => setFind({ rounding: v as Rounding, tolerance: undefined })}
          />
        </span>
        <span className="opt" title="Let numbers count as negative, e.g. a penalty that reduces interest — all of them, or at most a few">
          <span className="opt-name">Negatives</span>
          <Pick
            value={negMode}
            label="Negatives"
            options={[
              { value: 'off', label: 'off' },
              { value: 'on', label: 'any number of them', short: 'on' },
              { value: 'upto', label: 'at most…', short: 'up to' },
            ]}
            onChange={v => setNegatives(v, negSize)}
          >
            {negMode === 'upto' && (
              <CountBox
                value={negSize}
                min={1}
                max={MAX_NEGATIVES}
                label="Most numbers counted as negative"
                onChange={n => { setNegSize(n); if (Number.isInteger(n) && n >= 1 && n <= MAX_NEGATIVES) setNegatives('upto', n); }}
              />
            )}
          </Pick>
        </span>
      </div>
      <SizeNote />
      <input autoComplete="off"
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
