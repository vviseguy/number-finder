import { useMemo } from 'react';
import { IconAlertTriangle } from '@tabler/icons-react';
import {
  amountIndex, checkSecondsOf, fileTermText, filesByText, keysOf, scopeAmounts, scopePhrase, searchSecondsOf, setFind, setFindText, settingsFor, useAppState,
  type AppState, type FindSettings,
} from '../state/store';
import { coincidencePhrase, durationPhrase, estimateSearch } from '../lib/estimate';
import { formatMoney, madeOfLabel, negativesLabel, plural, secondsLabel } from '../lib/format';
import { dropTokens, parseQuery, passesTerms, serializeTerms, type Terms } from '../lib/query';
import { ROUNDING_TOLERANCE } from '../types';

/** The numbers a search would combine: the numbers in its files that pass the filters (zeros never join a sum). */
function candidateValues(s: AppState, scope: string[] | null, terms: Terms, skip: string[] = []): number[] {
  const idx = amountIndex(s);
  return scopeAmounts(s, scope, skip)
    .filter(a => { const h = idx.get(a.id); return !!h && Math.abs(a.value) >= 0.005 && passesTerms(a, fileTermText(h.file), terms); })
    .map(a => a.value);
}

type Patch = Partial<FindSettings>;

/** One-click ways to make a sum search smaller: fewer numbers per sum, or fewer or no negatives. */
export function NarrowChips({ settings, onApply }: { settings: FindSettings; onApply: (patch: Patch) => void }) {
  const chips: { label: string; title: string; patch: Patch }[] = [];
  if (settings.maxCount === null || settings.maxCount > 3) {
    chips.push({ label: 'Sums of up to 3', title: 'Most totals on a return are made of a few numbers', patch: { maxCount: 3, minCount: undefined } });
  }
  if (settings.allowFlips && (settings.maxFlips === undefined || settings.maxFlips > 1)) {
    chips.push({ label: 'At most 1 negative', title: 'Allow one number to count as negative, like a single penalty', patch: { maxFlips: 1 } });
  }
  if (settings.allowFlips) chips.push({ label: 'Negatives off', title: 'Count every number as it appears', patch: { allowFlips: false, maxFlips: undefined } });
  return (
    <>
      {chips.map(c => (
        <button key={c.label} type="button" className="btn sm narrow-chip" title={c.title} onClick={() => onApply(c.patch)}>{c.label}</button>
      ))}
      <span className="hint">or tick fewer files, or skip numbers with words like -hours</span>
    </>
  );
}

/** Words in the bar that override a setting a button just changed; they come out so the button takes effect. */
function overrides(patch: Patch): (raw: string) => boolean {
  return raw =>
    (('maxCount' in patch || 'minCount' in patch) && /^sums?:/i.test(raw))
    || (('allowFlips' in patch || 'maxFlips' in patch) && /^neg(?:atives?)?(?::.*)?$/i.test(raw))
    || ('seconds' in patch && /^(?:time|limit):/i.test(raw));
}

const median = (xs: number[]) => { const a = xs.map(Math.abs).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };

/**
 * Under the search bar, before anything runs: a warning when a sum search is too big to finish in its time
 * limit, or so big that sums will match the target by coincidence, with ways to narrow it.
 */
export function SizeNote() {
  const s = useAppState();
  const q = parseQuery(s.findText);
  const st = settingsFor(s, q);
  const checking = q.checkFiles.length > 0;
  const checkKeys = checking ? keysOf(q.checkFiles.flatMap(text => filesByText(s, text))) : [];
  const termsKey = serializeTerms(q.terms);
  const scopeKey = st.scope === null ? '*' : st.scope.join('\n');
  const values = useMemo(() => candidateValues(s, st.scope, q.terms, checkKeys), [s.files, scopeKey, termsKey, checkKeys.join('\n')]); // eslint-disable-line react-hooks/exhaustive-deps
  const checkTarget = useMemo(
    () => (checkKeys.length ? median(scopeAmounts(s, checkKeys).map(a => a.value)) : null),
    [s.files, checkKeys.join('\n')], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const target = checking ? checkTarget : q.numbers[0]?.value ?? null;
  const est = useMemo(
    () => estimateSearch({
      values, target, maxCount: st.maxCount, minCount: st.minCount, allowFlips: st.allowFlips, maxFlips: st.maxFlips,
      tolerance: st.tolerance ?? ROUNDING_TOLERANCE[st.rounding],
    }),
    [values, target, st.maxCount, st.minCount, st.allowFlips, st.maxFlips, st.tolerance, st.rounding],
  );

  // Nothing to warn about until there's a number to look for (the pruning in the estimate needs one).
  if (target === null || st.maxCount === 1 || q.range || q.errors.length || values.length < 2) return null;
  const limit = checking ? checkSecondsOf(st) : searchSecondsOf(st);
  const tooSlow = limit === null ? est.seconds > 600 : est.seconds > limit;
  const coincident = est.coincidences !== null && est.coincidences >= 1;
  if (!tooSlow && !coincident) return null;

  const what = checking ? 'a typical number' : q.numbers[0] ? formatMoney(q.numbers[0].value, q.numbers[0].decimals) : 'it';
  const neg = negativesLabel(st.allowFlips, st.maxFlips);
  const apply = (patch: Patch) => {
    setFind(patch);
    const text = dropTokens(s.findText, overrides(patch));
    if (text !== s.findText.trim()) setFindText(text);
  };
  return (
    <div className="size-note" role="note">
      <IconAlertTriangle size={14} aria-hidden />
      <span>
        <b>Big search:</b> {plural(values.length, 'number')} in {scopePhrase(s, st.scope, checkKeys)}, {madeOfLabel(st.maxCount, st.minCount)}{neg && ` with ${neg}`}.
        {tooSlow && ` Trying every sum would take ${durationPhrase(est.seconds)}${limit === null ? '' : checking ? `, and each number gets ${secondsLabel(limit)}` : `, and the limit is ${secondsLabel(limit)}`}.`}
        {coincident && ` At this size, ${coincidencePhrase(est.coincidences!, what)}.`}
        {' '}Narrow it first:
      </span>
      <span className="line"><NarrowChips settings={st} onApply={apply} /></span>
    </div>
  );
}
