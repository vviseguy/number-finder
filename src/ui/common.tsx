import { useEffect, useState } from 'react';
import { IconFileSpreadsheet, IconFileTypeCsv, IconFileTypePdf } from '@tabler/icons-react';
import type { FileKind } from '../types';
import type { Group } from '../state/store';
import { MADE_OF_HINT, MAX_SUM_SIZE, MIN_SUM_SIZE } from '../lib/format';

export function FileIcon({ kind, size = 16 }: { kind: FileKind | undefined; size?: number }) {
  if (kind === 'excel') return <IconFileSpreadsheet className="ficon excel" size={size} stroke={1.75} aria-hidden />;
  if (kind === 'csv') return <IconFileTypeCsv className="ficon csv" size={size} stroke={1.75} aria-hidden />;
  return <IconFileTypePdf className="ficon pdf" size={size} stroke={1.75} aria-hidden />;
}

export function GroupTag({ group, name }: { group?: Group; name?: string }) {
  if (!group) return <span className="gtag gall">{name ?? 'All files'}</span>;
  return <span className={`gtag gc${group.color}`}>{group.name}</span>;
}

/** Guess the file kind from a name, for files that aren't loaded (restored group members). */
export function kindFromName(name: string): FileKind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['csv', 'tsv', 'txt'].includes(ext)) return 'csv';
  return 'excel';
}

/**
 * "1 number | Sums of up to [N] | Any sum". value: 1, N (2–20), or null for any.
 * Typing a size selects the sums choice; the size is remembered while another choice is picked.
 */
export function MatchControl({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  const sums = typeof value === 'number' && value > 1;
  const [size, setSize] = useState(sums ? value : 3);
  const [raw, setRaw] = useState(String(size));
  useEffect(() => {
    if (typeof value === 'number' && value > 1) { setSize(value); setRaw(String(value)); }
  }, [value]);

  const commit = (text: string) => {
    setRaw(text);
    const n = Number(text);
    if (text.trim() === '' || !Number.isInteger(n) || n < MIN_SUM_SIZE || n > MAX_SUM_SIZE) return;
    setSize(n);
    onChange(n);
  };

  return (
    <span className="segmented" role="radiogroup" aria-label={label} title={MADE_OF_HINT}>
      <button type="button" role="radio" aria-checked={value === 1} className={value === 1 ? 'on' : ''} onClick={() => onChange(1)}>
        1 number
      </button>
      <span className={`seg-sum${sums ? ' on' : ''}`}>
        <button type="button" role="radio" aria-checked={sums} onClick={() => onChange(size)}>Sums of up to</button>
        <input
          type="number"
          min={MIN_SUM_SIZE}
          max={MAX_SUM_SIZE}
          step={1}
          value={raw}
          aria-label="Most numbers in a sum"
          className={raw === String(size) ? '' : 'invalid'}
          onFocus={() => { if (!sums) onChange(size); }}
          onChange={e => commit(e.target.value)}
          onBlur={() => setRaw(String(size))}
        />
      </span>
      <button type="button" role="radio" aria-checked={value === null} className={value === null ? 'on' : ''} onClick={() => onChange(null)}>
        Any sum
      </button>
    </span>
  );
}

/** Move focus between sibling items with ↑ ↓ (items carry data-nav). */
export function arrowNav(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-nav]')];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = items[e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)];
  if (next) { e.preventDefault(); next.focus(); next.click(); }
}
