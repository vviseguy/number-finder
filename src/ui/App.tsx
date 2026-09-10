import { useEffect } from 'react';
import { IconFileSearch, IconLock, IconUpload } from '@tabler/icons-react';
import { addFiles, setDragging, useAppState } from '../state/store';
import { FilesPanel } from './FilesPanel';
import { GroupsPanel } from './GroupsPanel';
import { FindCard } from './FindCard';
import { CheckSetup } from './CheckSetup';
import { SearchList } from './SearchList';
import { Results } from './Results';
import { CheckView } from './CheckView';
import { NoticeBar } from './NoticeBar';

export function App() {
  const s = useAppState();

  // Files can be dropped anywhere on the page.
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
    <div className="shell">
      <header className="topbar">
        <IconFileSearch className="brand-icon" size={20} stroke={1.75} aria-hidden />
        <h1>Number finder</h1>
        <span className="tagline">Find where a number on your return comes from</span>
        <span className="local-badge" title="This page can't send anything over the network. Your files are read inside this browser tab only.">
          <IconLock size={14} stroke={2} aria-hidden /> Files stay on this computer
        </span>
      </header>

      {s.view === 'check' && s.check ? (
        <CheckView />
      ) : (
        <div className="workspace">
          <aside className="sidebar" aria-label="Files and groups">
            <FilesPanel />
            <GroupsPanel />
          </aside>
          <main className="main">
            <FindCard />
            {s.checkSetupOpen && <CheckSetup />}
            <SearchList />
            <Results />
          </main>
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
