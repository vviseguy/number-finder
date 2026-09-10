import { useLayoutEffect, useState, type RefObject } from 'react';
import { useHover } from '../state/hover';
import { formatMoney } from '../lib/format';

interface Mark { top: number; height: number; own: boolean }

/**
 * Marks along a scroll container's right edge for every place the hovered value appears in it, like a
 * code editor's overview ruler. Render it as a sibling of the container, inside a position: relative wrapper.
 */
export function ScrollRail({ target }: { target: RefObject<HTMLElement | null> }) {
  const hover = useHover();
  const [marks, setMarks] = useState<Mark[]>([]);

  useLayoutEffect(() => {
    const c = target.current;
    if (!c || hover.key === null) { setMarks([]); return; }
    const compute = () => {
      const els = c.querySelectorAll<HTMLElement>(`[data-value="${hover.key}"]`);
      const crect = c.getBoundingClientRect();
      const sh = c.scrollHeight || 1;
      setMarks([...els].map(el => {
        const r = el.getBoundingClientRect();
        return { top: ((r.top - crect.top + c.scrollTop) / sh) * 100, height: (r.height / sh) * 100, own: el.dataset.id === hover.id };
      }));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(c);
    return () => ro.disconnect();
  }, [target, hover.key, hover.id]);

  if (!marks.length || hover.value === null) return null;
  return (
    <>
      <div className="rail" aria-hidden>
        {marks.map((m, i) => <span key={i} className={`mark${m.own ? ' own' : ''}`} style={{ top: `${m.top}%`, height: `${m.height}%` }} />)}
      </div>
      {marks.length > 1 && <span className="rail-count" aria-hidden>{formatMoney(hover.value)} · {marks.length} here</span>}
    </>
  );
}
