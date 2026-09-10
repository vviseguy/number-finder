import { useEffect, useRef } from 'react';
import { IconFileSearch, IconLock, IconUpload } from '@tabler/icons-react';
import { addFiles, setDragging, setView, useAppState, type View } from '../state/store';
import { FindBar } from './FindBar';
import { FilesView } from './FilesView';
import { GroupsView } from './GroupsView';
import { RunList } from './RunList';
import { Results } from './Results';
import { SidePane } from './SidePane';
import { NoticeBar } from './NoticeBar';
import { ScrollRail } from './ScrollRail';

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
    <div className="shell">
      <header className="topbar">
        <IconFileSearch className="brand-icon" size={20} stroke={1.75} aria-hidden />
        <h1>Number finder</h1>
        <nav className="steps" aria-label="Steps">
          {steps.map(st => (
            <button key={st.view} type="button" className={`step-tab${s.view === st.view ? ' on' : ''}`} aria-current={s.view === st.view ? 'page' : undefined} onClick={() => setView(st.view)}>
              <span className="step">{st.n}</span> {st.label}
              {st.count && <span className="count">{st.count}</span>}
            </button>
          ))}
        </nav>
        <span className="local-badge" title="This page can't send anything over the network. Your files are read inside this browser tab only.">
          <IconLock size={14} stroke={2} aria-hidden /> Files stay on this computer
        </span>
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
