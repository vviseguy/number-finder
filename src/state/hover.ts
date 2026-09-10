// Hover linking: while the pointer (or keyboard focus) is on anything that stands for an amount, every
// other place the same value appears lights up, and scroll rails mark where those places are.
// Kept out of the main store: it changes at pointer speed and is never saved.

import { useSyncExternalStore } from 'react';
import type { Amount } from '../types';

export interface Hover {
  /** The amount under the pointer. */
  id: string | null;
  /** Its value in cents, used to find matching places. */
  key: number | null;
  value: number | null;
}

const NONE: Hover = { id: null, key: null, value: null };
let hover: Hover = NONE;
const listeners = new Set<() => void>();

export const valueKey = (v: number) => Math.round(v * 100);

export function setHover(a: Amount | null) {
  const next = a ? { id: a.id, key: valueKey(a.value), value: a.value } : NONE;
  if (next.id === hover.id) return;
  hover = next;
  for (const l of listeners) l();
}

export function useHover(): Hover {
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, () => hover);
}

/** Spread onto any element that shows an amount. */
export function hoverProps(a: Amount) {
  return {
    'data-value': valueKey(a.value),
    'data-id': a.id,
    onMouseEnter: () => setHover(a),
    onMouseLeave: () => setHover(null),
    onFocus: () => setHover(a),
    onBlur: () => setHover(null),
  };
}

/** ' hovered' for the amount under the pointer, ' linked' for others with the same value, '' otherwise. */
export function useLinkClass(a: Amount | null): string {
  const h = useHover();
  if (!a || h.key === null || h.key !== valueKey(a.value)) return '';
  return h.id === a.id ? ' hovered' : ' linked';
}
