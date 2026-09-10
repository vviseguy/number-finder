import { formatMoney } from '../lib/format';

/**
 * An amount. When it's counted as negative in a sum, it's shown as −(265.44): the minus and the
 * parentheses in grey, the number itself as it appears in the file.
 */
export function Money({ value, decimals = 2, flipped = false }: { value: number; decimals?: number; flipped?: boolean }) {
  if (!flipped) return <span className="num">{formatMoney(value, decimals)}</span>;
  return (
    <span className="num flipped" title="Counted as negative">
      <span className="neg">−(</span>{formatMoney(value, decimals)}<span className="neg">)</span>
    </span>
  );
}
