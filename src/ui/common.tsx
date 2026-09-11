import { IconFileSpreadsheet, IconFileTypeCsv, IconFileTypePdf } from '@tabler/icons-react';
import type { FileKind } from '../types';
import type { Group } from '../state/store';

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

/** Move focus between sibling items with ↑ ↓ (items carry data-nav). */
export function arrowNav(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-nav]')];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = items[e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)];
  if (next) { e.preventDefault(); next.focus(); next.click(); }
}
