import { useEffect, useRef } from 'react';
import { IconFileSearch, IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconLock, IconUpload } from '@tabler/icons-react';
import { addFiles, setDragging, setLayout, useAppState } from '../state/store';
import { plural } from '../lib/format';
import { FilesPanel } from './FilesPanel';
import { GroupsPanel } from './GroupsPanel';
import { FindCard } from './FindCard';
import { RunList } from './RunList';
import { Results } from './Results';
import { SidePane } from './SidePane';
import { NoticeBar } from './NoticeBar';
import { ScrollRail } from './ScrollRail';

export function App() {
  const s = useAppState();
  const hidden = s.layout.sidebarHidden;
  const main = useRef<HTMLElement>(null);

  // Files can be dropped anywhere on the page, even with the files column hidden.
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
    <div className={`shell${hidden ? ' no-sidebar' : ''}`}>
      <header className="topbar">
        <button
          type="button"
          className="icon-btn sidebar-toggle"
          aria-label={hidden ? 'Show files and groups' : 'Hide files and groups'}
          title={hidden ? 'Show files and groups' : 'Hide files and groups'}
          aria-expanded={!hidden}
          onClick={() => setLayout({ sidebarHidden: !hidden })}
        >
          {hidden ? <IconLayoutSidebarLeftExpand size={18} stroke={1.75} /> : <IconLayoutSidebarLeftCollapse size={18} stroke={1.75} />}
        </button>
        <IconFileSearch className="brand-icon" size={20} stroke={1.75} aria-hidden />
        <h1>Number finder</h1>
        <span className="tagline">Find where a number on your return comes from</span>
        {hidden && (
          <button type="button" className="files-summary" onClick={() => setLayout({ sidebarHidden: false })} title="Show files and groups">
            {plural(s.files.length, 'file')} · {plural(s.groups.length, 'group')}
          </button>
        )}
        <span className="local-badge" title="This page can't send anything over the network. Your files are read inside this browser tab only.">
          <IconLock size={14} stroke={2} aria-hidden /> Files stay on this computer
        </span>
      </header>

      <div className="workspace">
        {!hidden && (
          <aside className="sidebar" aria-label="Files and groups">
            <FilesPanel />
            <GroupsPanel />
          </aside>
        )}
        <div className="col-wrap">
          <main className="main" ref={main}>
            <FindCard />
            <RunList />
            <Results />
          </main>
          <ScrollRail target={main} />
        </div>
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
