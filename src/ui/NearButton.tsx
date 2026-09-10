import { amountIndex } from '../state/store';
import { diffPhrase, formatMoney, locationShort } from '../lib/format';
import type { NearMiss } from '../lib/nearmiss';
import type { Amount } from '../types';

/** The likely-intended number for a miss: "Possible typo · two digits swapped" or "Closest number". */
export function NearButton({ near, target, decimals, onShow }: { near: NearMiss<Amount>; target: number; decimals: number; onShow: (id: string) => void }) {
  const hit = amountIndex().get(near.item.id);
  if (!hit) return null;
  return (
    <button type="button" className={`nearest${near.transposed ? ' typo' : ''}`} onClick={() => onShow(near.item.id)}>
      <span className="muted">{near.transposed ? 'Possible typo · two digits swapped' : 'Closest number'}</span>
      <span><b>{hit.file.name}</b> · {locationShort(hit.amount)} {hit.amount.label && <span className="label">{hit.amount.label}</span>}</span>
      <span><span className="num">{formatMoney(near.value, hit.amount.decimals)}</span> <span className="muted">{diffPhrase(near.diff, target, decimals)}</span></span>
    </button>
  );
}
