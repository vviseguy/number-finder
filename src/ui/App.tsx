import { useEffect, useRef } from 'react';
import { IconDeviceDesktop, IconFileSearch, IconLock, IconMoon, IconSun, IconUpload } from '@tabler/icons-react';
import { addFiles, notify, setDragging, setTheme, useAppState, type Theme } from '../state/store';
import { cleared } from '../lib/no-storage';
import { plural } from '../lib/format';
import { chooseFiles } from './FilePicker';
import { FindBar } from './FindBar';
import { RunList } from './RunList';
import { Results } from './Results';
import { SidePane } from './SidePane';
import { Splitter } from './Splitter';
import { NoticeBar } from './NoticeBar';
import { ScrollRail } from './ScrollRail';

const THEME_NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<Theme, string> = { system: 'Theme: follows your system', light: 'Theme: light', dark: 'Theme: dark' };

/** Cycles system → light → dark. */
function ThemeToggle({ theme }: { theme: Theme }) {
  const Icon = theme === 'light' ? IconSun : theme === 'dark' ? IconMoon : IconDeviceDesktop;
  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      aria-label={`${THEME_LABEL[theme]}. Switch to ${THEME_NEXT[theme] === 'system' ? 'system' : THEME_NEXT[theme]}`}
      title={`${THEME_LABEL[theme]} · click for ${THEME_NEXT[theme]}`}
      onClick={() => setTheme(THEME_NEXT[theme])}
    >
      <Icon size={17} stroke={1.75} />
    </button>
  );
}

export function App() {
  const s = useAppState();
  const main = useRef<HTMLElement>(null);

  // Opening the page clears everything saved at this address (see lib/no-storage.ts). Say so when there
  // was something, since it includes whatever another page at the same address had saved. The databases,
  // caches and files go in the background, so the count is read once they have had a moment.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (cleared.length) notify('info', `Cleared ${plural(cleared.length, 'thing')} the browser had saved at this address. Number finder saves nothing.`);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  // Files can be dropped anywhere on the page, on any view.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const over = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setDragging(true); } };
    const leave = (e: DragEvent) => { if (e.relatedTarget === null) setDragging(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void addFiles(files);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <div className="shell" style={{ ['--pane' as string]: `${s.paneWidth}px` }}>
      <header className="topbar">
        <div className="brand">
          <IconFileSearch className="brand-icon" size={22} stroke={1.75} aria-hidden />
          <span>
            <h1>Number finder</h1>
            <span className="brand-sub" title="Your files are read inside this browser tab and kept in memory only. Nothing is saved: close or reload the tab and everything is forgotten.">
              <IconLock size={12} stroke={2} aria-hidden /> All data stays local
            </span>
          </span>
        </div>
        <span className="drop-chip">
          <IconUpload size={14} stroke={1.75} aria-hidden />
          <span>Drop files anywhere, or <button type="button" className="link" onClick={chooseFiles}>choose files</button></span>
        </span>
        <ThemeToggle theme={s.theme} />
      </header>

      <FindBar />

      <div className="workspace">
        <div className="col-wrap">
          <main className="main find-main" ref={main}>
            <RunList />
            <Results />
          </main>
          <ScrollRail target={main} />
        </div>
        <Splitter />
        <SidePane />
      </div>

      <NoticeBar />
      {s.dragging && (
        <div className="drop-overlay" aria-hidden>
          <div><IconUpload size={28} stroke={1.5} /> Drop to add files</div>
        </div>
      )}
    </div>
  );
}
