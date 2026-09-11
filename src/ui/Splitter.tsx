import { useRef } from 'react';
import { MIN_PANE, setPaneWidth, useAppState } from '../state/store';

/** The drag handle between the main column and the side pane. Drag to resize; the width is remembered. */
export function Splitter() {
  const s = useAppState();
  const start = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    start.current = { x: e.clientX, width: s.paneWidth };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const max = Math.max(MIN_PANE, window.innerWidth - 480);
    setPaneWidth(Math.min(max, start.current.width + (start.current.x - e.clientX)));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    start.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove('resizing');
  };

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the side pane"
      aria-valuenow={s.paneWidth}
      tabIndex={0}
      title="Drag to resize"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft') setPaneWidth(s.paneWidth + 24);
        if (e.key === 'ArrowRight') setPaneWidth(s.paneWidth - 24);
      }}
    />
  );
}
