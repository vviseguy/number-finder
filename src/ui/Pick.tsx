import type { ReactNode } from 'react';
import { IconChevronDown } from '@tabler/icons-react';

export interface PickOption { value: string; label: string; /** Shorter text shown when this one is picked. */ short?: string }

/**
 * A dropdown only as wide as its current choice. The native <select> is invisible and stretched over the
 * nearest positioned ancestor (the whole pill), so a click anywhere on the pill opens the browser's own
 * list — which is styled through `option` in styles.css so it reads in dark mode. Keyboard and screen
 * readers see the real select. `children` (like the sum-size box) sit between the text and the arrow,
 * above the select.
 */
export function Pick({ value, options, onChange, label, className, children }: {
  value: string; options: PickOption[]; onChange: (v: string) => void; label: string; className?: string; children?: ReactNode;
}) {
  const cur = options.find(o => o.value === value) ?? options[0];
  return (
    <span className={`pick${className ? ` ${className}` : ''}`}>
      <span className="pick-text" aria-hidden>{cur?.short ?? cur?.label}</span>
      {children}
      <IconChevronDown size={12} stroke={2} className="pick-chev" aria-hidden />
      <select value={value} aria-label={label} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}
