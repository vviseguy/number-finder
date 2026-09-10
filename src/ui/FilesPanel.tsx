import { useRef } from 'react';
import { IconAlertTriangle, IconLoader2, IconUpload, IconX } from '@tabler/icons-react';
import { addFiles, groupsOfFile, removeFile, showPreview, useAppState } from '../state/store';
import { fileMeta, plural } from '../lib/format';
import { FileIcon, GroupTag, kindFromName } from './common';

const ACCEPT = '.pdf,.xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt';

export function FilesPanel() {
  const s = useAppState();
  const input = useRef<HTMLInputElement>(null);

  // Files that saved groups expect but that haven't been dropped in this session.
  const loaded = new Set(s.files.map(f => f.key));
  const missing = [...new Map(s.groups.flatMap(g => g.members).filter(m => !loaded.has(m.key)).map(m => [m.key, m])).values()];
  const empty = !s.files.length && !missing.length;

  return (
    <section className="panel" aria-labelledby="h-files">
      <h2 id="h-files" className="step-h">
        <span className="step">1</span> Files
        {s.files.length > 0 && <span className="count">{plural(s.files.length, 'file')}</span>}
      </h2>

      {(s.files.length > 0 || missing.length > 0) && (
        <ul className="file-list">
          {s.files.map(f => {
            const groups = groupsOfFile(s, f.key);
            const first = f.parsed?.amounts[0];
            return (
              <li key={f.id} className="file-row">
                <FileIcon kind={f.parsed?.kind ?? kindFromName(f.name)} />
                <div className="file-body">
                  <button
                    type="button"
                    className="file-name"
                    disabled={!first}
                    title={first ? 'Show this file' : undefined}
                    onClick={() => first && showPreview(first.id)}
                  >
                    {f.name}
                  </button>
                  {f.status === 'reading' && <div className="meta"><IconLoader2 className="spin" size={12} aria-hidden /> Reading…</div>}
                  {f.status === 'error' && <div className="warn-line"><IconAlertTriangle size={12} aria-hidden /> {f.error}</div>}
                  {f.parsed?.warnings.map(w => <div key={w} className="warn-line"><IconAlertTriangle size={12} aria-hidden /> {w}</div>)}
                  {f.parsed && (
                    <div className="meta">
                      {fileMeta(f.parsed)}
                      {groups.length ? groups.map(g => <GroupTag key={g.id} group={g} />) : <span className="muted"> · not in a group</span>}
                    </div>
                  )}
                </div>
                <button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => removeFile(f.id)}>
                  <IconX size={14} />
                </button>
              </li>
            );
          })}
          {missing.map(m => (
            <li key={m.key} className="file-row missing">
              <FileIcon kind={kindFromName(m.name)} />
              <div className="file-body">
                <span className="file-name">{m.name}</span>
                <div className="meta">Not added yet · drop it in to restore its groups</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className={`dropzone${empty ? ' first-run' : ''}`}>
        <IconUpload size={empty ? 22 : 16} stroke={1.5} aria-hidden />
        <span>{empty ? 'Drop your tax documents here' : 'Drop PDF, Excel, or CSV files here'}</span>
        {empty && <span className="hint">PDFs, Excel workbooks, and CSV files. They're read inside this page and never uploaded.</span>}
        <button type="button" className="btn sm" onClick={() => input.current?.click()}>Choose files</button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) void addFiles(files); }}
        />
      </div>
    </section>
  );
}
