import { useEffect, useRef, useState } from 'react';
import { IconAlertTriangle, IconEye, IconLoader2, IconPencil, IconUpload, IconX } from '@tabler/icons-react';
import { addMember, fileLabel, groupsOfFile, removeFile, setNick, showPreview, useAppState, type FileEntry } from '../state/store';
import { fileMeta, plural } from '../lib/format';
import { FileIcon, GroupTag, kindFromName } from './common';
import { chooseFiles } from './FindBar';
import { Preview } from './Preview';

/** Step 1: every file, with a short name you can give it, what was read from it, and its groups. */
export function FilesView() {
  const s = useAppState();
  const loaded = new Set(s.files.map(f => f.key));
  const missing = [...new Map(s.groups.flatMap(g => g.members).filter(m => !loaded.has(m.key)).map(m => [m.key, m])).values()];
  const previewFile = s.previewId ? s.files.find(f => s.previewId!.startsWith(`${f.id}:`)) : undefined;

  if (!s.files.length && !missing.length) {
    return (
      <div className="view files-view">
        <button type="button" className="dropzone first-run big" onClick={chooseFiles}>
          <IconUpload size={28} stroke={1.5} aria-hidden />
          <span>Drop your tax documents here</span>
          <span className="hint">PDFs, Excel workbooks, and CSV files. They're read inside this page and never uploaded. Click to choose files.</span>
        </button>
      </div>
    );
  }

  return (
    <div className="workspace files-workspace">
      <main className="main files-main">
        <h2 className="view-title">Files <span className="count">{plural(s.files.length, 'file')}</span></h2>
        <div className="files-table" role="table">
          <div className="files-head" role="row">
            <span role="columnheader">File</span>
            <span role="columnheader">What was read</span>
            <span role="columnheader">Groups</span>
            <span role="columnheader" />
          </div>
          {s.files.map(f => <FileRow key={f.id} file={f} selected={previewFile?.id === f.id} />)}
          {missing.map(m => (
            <div key={m.key} className="file-row missing" role="row">
              <span className="file-cell" role="cell">
                <FileIcon kind={kindFromName(m.name)} />
                <span className="file-name">{s.nicks[m.key] || m.name}</span>
              </span>
              <span className="meta" role="cell">Not added yet · drop it in to restore its groups</span>
              <span role="cell">{groupsOfFile(s, m.key).map(g => <GroupTag key={g.id} group={g} />)}</span>
              <span role="cell" />
            </div>
          ))}
        </div>
        <p className="hint">Give a file a short name with the pencil: it's used everywhere instead of the file name. Click a file to see it on the right.</p>
      </main>
      <aside className="side-pane" aria-label="File preview">
        {previewFile && s.previewId ? <Preview amountId={s.previewId} /> : (
          <div className="pane-empty">
            <IconEye size={24} stroke={1.5} aria-hidden />
            <p>Click a file to see it here.</p>
            <p className="hint">Every number in it is clickable: click one to search for it.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function FileRow({ file: f, selected }: { file: FileEntry; selected: boolean }) {
  const s = useAppState();
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  const groups = groupsOfFile(s, f.key);
  const first = f.parsed?.amounts[0];
  const addable = s.groups.filter(g => !g.members.some(m => m.key === f.key));
  const commit = (value: string) => { setNick(f.id, value); setEditing(false); };

  return (
    <div className={`file-row${selected ? ' selected' : ''}`} role="row" onClick={() => first && showPreview(first.id)}>
      <span className="file-cell" role="cell">
        <FileIcon kind={f.parsed?.kind ?? kindFromName(f.name)} />
        <span className="file-names">
          {editing ? (
            <input
              ref={input}
              className="nick-input"
              defaultValue={fileLabel(f)}
              aria-label={`Short name for ${f.name}`}
              onClick={e => e.stopPropagation()}
              onBlur={e => commit(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { e.currentTarget.value = fileLabel(f); e.currentTarget.blur(); }
              }}
            />
          ) : (
            <span className="file-name-line">
              <span className="file-name">{fileLabel(f)}</span>
              <button type="button" className="icon-btn" aria-label={`Rename ${f.name}`} title="Give it a short name" onClick={e => { e.stopPropagation(); setEditing(true); }}>
                <IconPencil size={13} />
              </button>
            </span>
          )}
          {f.nick && <span className="meta">{f.name}</span>}
        </span>
      </span>
      <span className="read-cell" role="cell">
        {f.status === 'reading' && <span className="meta"><IconLoader2 className="spin" size={12} aria-hidden /> Reading…</span>}
        {f.status === 'error' && <span className="warn-line"><IconAlertTriangle size={12} aria-hidden /> {f.error}</span>}
        {f.parsed && <span>{fileMeta(f.parsed)}</span>}
        {f.parsed?.warnings.map(w => <span key={w} className="warn-line"><IconAlertTriangle size={12} aria-hidden /> {w}</span>)}
      </span>
      <span className="groups-cell" role="cell" onClick={e => e.stopPropagation()}>
        {groups.map(g => <GroupTag key={g.id} group={g} />)}
        {addable.length > 0 && (
          <select className="add-to-group" value="" aria-label={`Add ${fileLabel(f)} to a group`} onChange={e => { if (e.target.value) addMember(e.target.value, f); }}>
            <option value="">{groups.length ? '+ group…' : '+ Add to group…'}</option>
            {addable.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        {!groups.length && !addable.length && <span className="muted">not in a group</span>}
      </span>
      <span role="cell" className="actions-cell" onClick={e => e.stopPropagation()}>
        <button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => removeFile(f.id)}>
          <IconX size={14} />
        </button>
      </span>
    </div>
  );
}
