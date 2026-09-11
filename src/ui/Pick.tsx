import { IconChevronDown } from '@tabler/icons-react';

export interface PickOption { value: string; label: string; /** Shorter text shown when this one is picked. */ short?: string }

/**
 * A dropdown that is only as wide as its current choice. The native <select> sits invisibly over the
 * text so the keyboard, screen readers, and the browser's own list still work; the list itself is styled
 * through `option` in styles.css so it reads in dark mode too.
 */
export function Pick({ value, options, onChange, label, className, title }: {
  value: string; options: PickOption[]; onChange: (v: string) => void; label: string; className?: string; title?: string;
}) {
  const cur = options.find(o => o.value === value) ?? options[0];
  return (
    <span className={`pick${className ? ` ${className}` : ''}`} title={title}>
      <span className="pick-text" aria-hidden>{cur?.short ?? cur?.label}<IconChevronDown size={12} stroke={2} className="pick-chev" /></span>
      <select value={value} aria-label={label} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}
