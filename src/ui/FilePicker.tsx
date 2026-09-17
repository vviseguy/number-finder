import { useEffect, useRef, useState } from 'react';
import {
  IconAlertTriangle, IconChevronDown, IconFolder, IconFolderOpen, IconListCheck, IconLoader2, IconPencil, IconPlus, IconRefresh, IconX,
} from '@tabler/icons-react';
import {
  checkFile, fileLabel, openFolder, removeFile, rereadFolder, setNick, setScope, showFile, toggleScopeFile, useAppState,
  type FileEntry, type FolderState,
} from '../state/store';
import { canOpenFolder } from '../lib/folder';
import { fileMeta, plural } from '../lib/format';
import { FileIcon, kindFromName } from './common';

export function chooseFiles() { document.getElementById('file-input')?.click(); }

export function OpenFolderButton({ className = 'btn sm' }: { className?: string }) {
  if (!canOpenFolder) return null;
  return (
    <button type="button" className={className} title="Read every PDF, Excel, and CSV file in a folder and its subfolders (for this session only)" onClick={() => void openFolder()}>
      <IconFolderOpen size={13} aria-hidden /> Open folder…
    </button>
  );
}

/** The folder opened this session, and a way to read it again for new or changed files. */
export function FolderLine({ folder }: { folder: FolderState }) {
  return (
    <p className="hint folder-line">
      <IconFolder size={13} aria-hidden />
      {folder.status === 'reading' && <span>Reading the folder <b>{folder.name}</b>…</span>}
      {folder.status === 'ready' && <span>Files from the folder <b>{folder.name}</b>.</span>}
      {folder.status === 'gone' && <span>Couldn't read the folder <b>{folder.name}</b>. Was it moved or renamed?</span>}
      {folder.status !== 'reading' && (
        <button type="button" className="link" onClick={() => void rereadFolder()}><IconRefresh size={11} aria-hidden /> Read again</button>
      )}
    </p>
  );
}

/**
 * The "in" part of the search bar: which files to search, as a checklist. Every file is ticked until the
 * person unticks some (scope null = every file, including files added later). With check: in the bar it
 * reads "against", and the files being checked are left out of the list's ticks.
 * Each file also has its short name, what was read from it, and buttons to check it or remove it.
 */
export function FilePicker({ checking }: { checking: string[] }) {
  const s = useAppState();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const scope = s.find.scope;
  const files = s.files;
  const ticked = (f: FileEntry) => scope === null || scope.includes(f.key);
  const choosable = files.filter(f => !checking.includes(f.key));
  const chosen = choosable.filter(ticked);
  const reading = files.filter(f => f.status === 'reading').length;
  const label = !files.length ? 'No files yet'
    : scope === null ? (checking.length ? 'The other files' : 'All files')
    : chosen.length === 0 ? 'No files'
    : chosen.length === 1 ? fileLabel(chosen[0])
    : `${chosen.length} of ${plural(choosable.length, 'file')}`;

  return (
    <span className="where" ref={root}>
      <button
        type="button"
        id="file-picker"
        className="where-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-files={files.length}
        data-reading={reading}
        title={checking.length ? 'The files the numbers are looked up in' : 'The files to search in'}
        onClick={() => setOpen(o => !o)}
      >
        <span className="sentence">{checking.length ? 'against' : 'in'}</span>
        <span className={`pick-text${chosen.length === 0 && files.length ? ' none' : ''}`}>{label}</span>
        {reading > 0 && <IconLoader2 className="spin" size={13} aria-label={`Reading ${plural(reading, 'file')}`} />}
        <IconChevronDown size={12} stroke={2} className="pick-chev" aria-hidden />
      </button>
      {open && (
        <div className="file-panel" role="dialog" aria-label="Files to search">
          <div className="file-panel-head">
            <b>{checking.length ? 'Look the numbers up in' : 'Search in'}</b>
            {files.length > 0 && (
              <span className="push line">
                <button type="button" className="link" disabled={scope === null} onClick={() => setScope(null)}>Select all</button>
                <button type="button" className="link" disabled={scope !== null && scope.length === 0} onClick={() => setScope([])}>Select none</button>
              </span>
            )}
          </div>
          {files.length
            ? (
              <ul className="file-list">
                {files.map(f => <FileItem key={f.id} file={f} ticked={ticked(f)} checked={checking.includes(f.key)} onCheck={() => setOpen(false)} />)}
              </ul>
            )
            : <p className="hint pad">No files yet. Drop PDFs, Excel workbooks, or CSV files anywhere on the page.</p>}
          <div className="file-panel-foot">
            {s.folder && <FolderLine folder={s.folder} />}
            <span className="line">
              <button type="button" className="btn sm" onClick={chooseFiles}><IconPlus size={13} aria-hidden /> Add files…</button>
              <OpenFolderButton />
            </span>
          </div>
        </div>
      )}
    </span>
  );
}

function FileItem({ file: f, ticked, checked, onCheck }: { file: FileEntry; ticked: boolean; checked: boolean; onCheck: () => void }) {
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);
  const label = fileLabel(f);
  const readable = !!f.parsed?.amounts.length;
  const commit = (value: string) => { setNick(f.id, value); setEditing(false); };

  return (
    <li className={`file-item${checked ? ' checking' : ''}`}>
      <input
        autoComplete="off"
        type="checkbox"
        checked={ticked && !checked}
        disabled={checked}
        aria-label={`Search in ${f.name}`}
        onChange={() => toggleScopeFile(f.key)}
      />
      <FileIcon kind={f.parsed?.kind ?? kindFromName(f.name)} />
      <span className="file-item-names">
        {editing ? (
          <input
            autoComplete="off"
            ref={input}
            className="nick-input"
            defaultValue={label}
            aria-label={`Short name for ${f.name}`}
            onBlur={e => commit(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } // not the search form's Enter
              if (e.key === 'Escape') { e.stopPropagation(); e.currentTarget.value = label; e.currentTarget.blur(); }
            }}
          />
        ) : (
          <span className="file-item-line">
            <button type="button" className="file-item-name" disabled={!readable} title={readable ? `${f.name}: show it on the right` : f.name} onClick={() => showFile(f.id)}>
              {label}
            </button>
            <button type="button" className="icon-btn reveal" aria-label={`Rename ${f.name}`} title="Give it a short name (for this session)" onClick={() => setEditing(true)}>
              <IconPencil size={12} />
            </button>
          </span>
        )}
        <span className="meta">
          {label !== f.name && <span title={f.name}>{f.name} · </span>}
          {f.status === 'reading' && <><IconLoader2 className="spin" size={11} aria-hidden /> Reading…</>}
          {f.parsed && fileMeta(f.parsed)}
          {checked && ' · being checked'}
        </span>
        {f.status === 'error' && <span className="warn-line"><IconAlertTriangle size={11} aria-hidden /> {f.error}</span>}
        {f.parsed?.warnings.map(w => <span key={w} className="warn-line"><IconAlertTriangle size={11} aria-hidden /> {w}</span>)}
      </span>
      <span className="file-item-actions">
        <button
          type="button"
          className="icon-btn"
          disabled={!readable}
          aria-label={`Check every number in ${f.name}`}
          title="Check every number in this file against the other ticked files: puts check: in the search bar"
          onClick={() => { checkFile(f.key); onCheck(); }}
        >
          <IconListCheck size={14} />
        </button>
        <button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => removeFile(f.id)}>
          <IconX size={14} />
        </button>
      </span>
    </li>
  );
}
