import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconChevronLeft, IconChevronRight, IconEye } from '@tabler/icons-react';
import * as XLSX from 'xlsx';
import type { PageViewport } from 'pdfjs-dist';
import { amountIndex, fileData, searchForAmount, useAppState, type FileEntry } from '../state/store';
import { locationShort } from '../lib/format';
import { loadPdf } from '../lib/pdf';
import type { Amount } from '../types';

interface PreviewProps {
  amountId: string;
  /** Amounts the prev/next buttons step through (e.g. every item in the results). */
  navIds?: string[];
  navNoun?: string;
  onNavigate?: (id: string) => void;
}

export function Preview({ amountId, navIds = [], navNoun = 'Match', onNavigate }: PreviewProps) {
  const s = useAppState();
  const hit = amountIndex(s).get(amountId);
  if (!hit) return null;
  const { amount, file } = hit;
  const i = navIds.indexOf(amountId);

  return (
    <div className="preview" aria-label={`Preview of ${file.name}`}>
      <div className="preview-head">
        <IconEye size={14} aria-hidden />
        <b>{file.name}</b> · {locationShort(amount)}
        {navIds.length > 1 && i >= 0 && onNavigate && (
          <span className="push nav">
            <button type="button" className="icon-btn" aria-label={`Previous ${navNoun.toLowerCase()}`} disabled={i === 0} onClick={() => onNavigate(navIds[i - 1])}><IconChevronLeft size={14} /></button>
            {navNoun} {i + 1} of {navIds.length}
            <button type="button" className="icon-btn" aria-label={`Next ${navNoun.toLowerCase()}`} disabled={i === navIds.length - 1} onClick={() => onNavigate(navIds[i + 1])}><IconChevronRight size={14} /></button>
          </span>
        )}
      </div>
      <div className="preview-body">
        {amount.location.kind === 'pdf'
          ? <PdfPage file={file} page={amount.location.page} highlight={amount} />
          : <SheetWindow file={file} highlight={amount} />}
      </div>
      <p className="hint preview-foot">Click any number here to search for it.</p>
    </div>
  );
}

// ---------- PDF page ----------

function PdfPage({ file, page, highlight }: { file: FileEntry; page: number; highlight: Amount }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [failed, setFailed] = useState(false);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const data = fileData.get(file.id);
    const el = canvas.current;
    if (!data || !el || width < 50) return;
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    (async () => {
      try {
        const doc = await loadPdf(file.id, data);
        const p = await doc.getPage(page);
        if (cancelled) return;
        const scale = width / p.getViewport({ scale: 1 }).width;
        const dpr = window.devicePixelRatio || 1;
        const vp = p.getViewport({ scale: scale * dpr });
        el.width = Math.floor(vp.width);
        el.height = Math.floor(vp.height);
        el.style.width = `${width}px`;
        el.style.height = `${Math.floor(vp.height / dpr)}px`;
        const ctx = el.getContext('2d');
        if (!ctx) return;
        task = p.render({ canvas: el, canvasContext: ctx, viewport: vp } as Parameters<typeof p.render>[0]);
        await task.promise;
        if (!cancelled) { setViewport(p.getViewport({ scale })); setFailed(false); }
      } catch (err) {
        if (!cancelled && !(err instanceof Error && err.name === 'RenderingCancelledException')) { console.error(err); setFailed(true); }
      }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [file.id, page, width]);

  const onPage = useMemo(
    () => (file.parsed?.amounts ?? []).filter(a => a.location.kind === 'pdf' && a.location.page === page),
    [file.parsed, page],
  );

  // Center the highlighted number inside the preview's own scroll area. (scrollIntoView would also scroll
  // the whole page, making the table jump every time a row is selected.)
  const hitRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const hit = hitRef.current;
    const box = hit?.closest<HTMLElement>('.preview-body');
    if (!hit || !box) return;
    const b = box.getBoundingClientRect();
    const h = hit.getBoundingClientRect();
    box.scrollTo({ top: box.scrollTop + (h.top - b.top) - (b.height - h.height) / 2, behavior: 'smooth' });
  }, [highlight.id, viewport]);

  return (
    <div className="pdf-page" ref={wrap}>
      <canvas ref={canvas} aria-label={`${file.name}, page ${page}`} />
      {failed && <p className="warn-line pad">This page couldn't be drawn, but its numbers were read.</p>}
      {viewport && onPage.map(a => {
        if (a.location.kind !== 'pdf') return null;
        const [x, y, w, h] = a.location.box;
        const [x1, y1] = viewport.convertToViewportPoint(x, y) as [number, number];
        const [x2, y2] = viewport.convertToViewportPoint(x + w, y + h) as [number, number];
        const style = { left: Math.min(x1, x2) - 2, top: Math.min(y1, y2) - 2, width: Math.abs(x2 - x1) + 4, height: Math.abs(y2 - y1) + 4 };
        const isHit = a.id === highlight.id;
        return (
          <button
            key={a.id}
            ref={isHit ? hitRef : undefined}
            type="button"
            className={`hotspot${isHit ? ' hit' : ''}`}
            style={style}
            title={`Search for ${a.text}${a.label ? ` (${a.label})` : ''}`}
            aria-label={`Search for ${a.text}`}
            onClick={() => searchForAmount(a.id)}
          />
        );
      })}
    </div>
  );
}

// ---------- spreadsheet window ----------

const workbooks = new Map<string, XLSX.WorkBook>();

function workbookFor(file: FileEntry): XLSX.WorkBook | null {
  let wb = workbooks.get(file.id);
  const data = fileData.get(file.id);
  if (!wb && data) {
    try { wb = XLSX.read(new Uint8Array(data), { type: 'array' }); workbooks.set(file.id, wb); } catch { return null; }
  }
  return wb ?? null;
}

function SheetWindow({ file, highlight }: { file: FileEntry; highlight: Amount }) {
  if (highlight.location.kind !== 'sheet') return null;
  const { sheet, cell } = highlight.location;
  const wb = workbookFor(file);
  const ws = wb?.Sheets[sheet === 'CSV' ? wb.SheetNames[0] : sheet];
  if (!ws) return <p className="warn-line pad">This sheet couldn't be shown, but its numbers were read.</p>;

  const at = XLSX.utils.decode_cell(cell);
  const r0 = Math.max(0, at.r - 6), c0 = Math.max(0, at.c - 3);
  const rows = Array.from({ length: 13 }, (_, i) => r0 + i);
  const cols = Array.from({ length: 7 }, (_, i) => c0 + i);
  const amountsByCell = new Map(
    (file.parsed?.amounts ?? []).flatMap(a => (a.location.kind === 'sheet' && a.location.sheet === sheet ? [[a.location.cell, a] as const] : [])),
  );

  return (
    <div className="sheet-window">
      <table>
        <thead>
          <tr><th />{cols.map(c => <th key={c}>{XLSX.utils.encode_col(c)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r}>
              <th>{r + 1}</th>
              {cols.map(c => {
                const addr = XLSX.utils.encode_cell({ r, c });
                const v = ws[addr] as XLSX.CellObject | undefined;
                const text = v ? (v.w ?? (v.v === undefined || v.v === null ? '' : String(v.v))) : '';
                const a = amountsByCell.get(addr);
                if (!a) return <td key={c} className={typeof v?.v === 'number' ? 'n' : ''}>{text}</td>;
                return (
                  <td key={c} className={`n${a.id === highlight.id ? ' hit' : ''}`}>
                    <button type="button" className="cell-btn" title={`Search for ${a.text}`} onClick={() => searchForAmount(a.id)}>{text}</button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
