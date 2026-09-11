import { useEffect, useRef, useState } from 'react';
import { IconListCheck, IconPencil, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { addMember, checkGroup, createGroup, deleteGroup, fileLabel, removeMember, renameGroup, setLimit, useAppState, type Group } from '../state/store';
import { describeLimit, parseLimit, plural } from '../lib/format';

/** Step 2: groups are sets of files to search in. A file can be in several. */
export function GroupsView() {
  const s = useAppState();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="view groups-view">
      <div className="line">
        <h2 className="view-title">Groups <span className="count">{plural(s.groups.length, 'group')}</span></h2>
        <button type="button" className="btn push" onClick={() => setEditing(createGroup())}>
          <IconPlus size={14} aria-hidden /> Add group
        </button>
      </div>
      <p className="muted">
        A group is a set of files to search in, like <b>Source docs</b> or <b>2025 return</b>. A file can be in several groups. Until you make one, searches look through all files.
        To check a whole return, put it in one group and your source documents in another, then press <b>Check every number</b> on the return's card.
      </p>
      <div className="groups-grid">
        {s.groups.map(g => <GroupCard key={g.id} group={g} editing={editing === g.id} onEdit={v => setEditing(v ? g.id : null)} />)}
      </div>
    </div>
  );
}

function GroupCard({ group, editing, onEdit }: { group: Group; editing: boolean; onEdit: (v: boolean) => void }) {
  const s = useAppState();
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) nameInput.current?.select(); }, [editing]);

  const loaded = new Map(s.files.map(f => [f.key, f]));
  const addable = s.files.filter(f => !group.members.some(m => m.key === f.key));

  return (
    <div className="group-card">
      <div className="group-head">
        {editing ? (
          <input
            ref={nameInput}
            className="group-name-input"
            defaultValue={group.name}
            aria-label="Group name"
            onBlur={e => { renameGroup(group.id, e.target.value); onEdit(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') { e.currentTarget.value = group.name; e.currentTarget.blur(); }
            }}
          />
        ) : (
          <button type="button" className={`gtag gc${group.color} as-button`} title="Rename" onClick={() => onEdit(true)}>
            {group.name} <IconPencil size={11} aria-hidden />
          </button>
        )}
        <span className="col-label" title="Most numbers a match may use from each file: 1, 0-2, 1-2 (at least one), or any">numbers per file</span>
        <button type="button" className="icon-btn" aria-label={`Delete ${group.name}`} title="Delete group" onClick={() => deleteGroup(group.id)}>
          <IconTrash size={13} />
        </button>
      </div>

      {group.members.length === 0 && <p className="hint">No files yet. Add some below.</p>}
      {group.members.map(m => {
        const file = loaded.get(m.key);
        const label = file ? fileLabel(file) : s.nicks[m.key] || m.name;
        const valid = parseLimit(m.limit) !== null;
        return (
          <div key={m.key} className={`member${file ? '' : ' missing'}`}>
            <span className="member-name" title={file ? m.name : `${m.name} isn't added yet`}>{label}</span>
            <input
              className={`limit${valid ? '' : ' invalid'}`}
              value={m.limit}
              placeholder="any"
              aria-label={`Numbers from ${m.name}`}
              title={valid ? describeLimit(m.limit) : 'Use 1, 0-2, 1-2, 2+, or any'}
              onChange={e => setLimit(group.id, m.key, e.target.value)}
            />
            <button type="button" className="icon-btn" aria-label={`Remove ${m.name} from ${group.name}`} onClick={() => removeMember(group.id, m.key)}>
              <IconX size={12} />
            </button>
          </div>
        );
      })}

      {addable.length > 0 && (
        <select
          className="add-file"
          value=""
          aria-label={`Add a file to ${group.name}`}
          onChange={e => {
            const f = s.files.find(x => x.key === e.target.value);
            if (f) addMember(group.id, f);
            if (e.target.value === '__all__') addable.forEach(x => addMember(group.id, x));
          }}
        >
          <option value="">+ Add file…</option>
          {addable.map(f => <option key={f.key} value={f.key}>{f.name}</option>)}
          {addable.length > 1 && <option value="__all__">All {addable.length} files not in this group</option>}
        </select>
      )}
      {group.members.length > 0 && (
        <button
          type="button"
          className="btn sm check-btn"
          title={`Look up every number in ${group.name} in another group: puts check:"${group.name}" in the search bar`}
          onClick={() => checkGroup(group.id)}
        >
          <IconListCheck size={13} aria-hidden /> Check every number…
        </button>
      )}
    </div>
  );
}
