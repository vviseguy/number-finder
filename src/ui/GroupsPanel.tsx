import { useEffect, useRef, useState } from 'react';
import { IconPencil, IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { addMember, createGroup, deleteGroup, removeMember, renameGroup, setLimit, useAppState, type Group } from '../state/store';
import { describeLimit, parseLimit } from '../lib/format';

export function GroupsPanel() {
  const s = useAppState();
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className="panel" aria-labelledby="h-groups">
      <h2 id="h-groups" className="step-h">
        <span className="step">2</span> Groups
        <button type="button" className="btn sm push" onClick={() => setEditing(createGroup())}>
          <IconPlus size={13} aria-hidden /> Add group
        </button>
      </h2>
      {!s.groups.length && (
        <p className="empty-note">
          A group is a set of files to search in, like <b>Source docs</b> or <b>2025 return</b>. Until you make one, searches look through all files.
        </p>
      )}
      {s.groups.map(g => (
        <GroupCard key={g.id} group={g} editing={editing === g.id} onEdit={v => setEditing(v ? g.id : null)} />
      ))}
    </section>
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
        const valid = parseLimit(m.limit) !== null;
        return (
          <div key={m.key} className={`member${file ? '' : ' missing'}`}>
            <span className="member-name" title={file ? m.name : `${m.name} isn't added yet`}>{m.name}</span>
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
    </div>
  );
}
