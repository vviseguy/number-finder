import { useEffect, useRef } from 'react';
import { IconArrowRight, IconDeviceDesktop, IconFileSearch, IconLock, IconMoon, IconSun, IconUpload } from '@tabler/icons-react';
import { addFiles, setDragging, setTheme, setView, useAppState, type Theme, type View } from '../state/store';
import { chooseFiles, FindBar } from './FindBar';
import { FilesView } from './FilesView';
import { GroupsView } from './GroupsView';
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

  const steps: { view: View; n: number; label: string; count: string }[] = [
    { view: 'files', n: 1, label: 'Files', count: String(s.files.length) },
    { view: 'groups', n: 2, label: 'Groups', count: String(s.groups.length) },
    { view: 'find', n: 3, label: 'Find', count: s.runs.length ? String(s.runs.length) : '' },
  ];

  return (
    <div className="shell" style={{ ['--pane' as string]: `${s.paneWidth}px` }}>
      <header className="topbar">
        <div className="brand">
          <IconFileSearch className="brand-icon" size={22} stroke={1.75} aria-hidden />
          <div>
            <h1>Number finder</h1>
            <p className="brand-sub" title="This page can't send anything over the network. Your files are read inside this browser tab only.">
              <IconLock size={11} stroke={2} aria-hidden /> Files stay on this computer
            </p>
          </div>
        </div>
        <nav className="steps" aria-label="Steps">
          {steps.map((st, i) => (
            <span key={st.view} className="step-wrap">
              {i > 0 && <IconArrowRight size={15} stroke={1.75} className="step-arrow" aria-hidden />}
              <button type="button" className={`step-tab${s.view === st.view ? ' on' : ''}`} aria-current={s.view === st.view ? 'page' : undefined} onClick={() => setView(st.view)}>
                <span className="step">{st.n}</span> {st.label}
                {st.count && <span className="count">{st.count}</span>}
              </button>
            </span>
          ))}
        </nav>
        <span className="drop-chip">
          <IconUpload size={14} stroke={1.75} aria-hidden />
          <span>Drop files anywhere, or <button type="button" className="link" onClick={chooseFiles}>choose files</button></span>
        </span>
        <ThemeToggle theme={s.theme} />
      </header>

      <FindBar />

      {s.view === 'files' && <FilesView />}
      {s.view === 'groups' && <GroupsView />}
      {s.view === 'find' && (
        <div className="workspace">
          <div className="col-wrap">
            <main className="main" ref={main}>
              <RunList />
              <Results />
            </main>
            <ScrollRail target={main} />
          </div>
          <Splitter />
          <SidePane />
        </div>
      )}

      <NoticeBar />
      {s.dragging && (
        <div className="drop-overlay" aria-hidden>
          <div><IconUpload size={28} stroke={1.5} /> Drop to add files</div>
        </div>
      )}
    </div>
  );
}
