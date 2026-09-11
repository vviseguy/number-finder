// A folder of documents, remembered between sessions (Chromium's File System Access API: Edge, Chrome).
//
// Browsers never let a page read files from disk on its own. The closest thing: the person picks a
// folder once, the page keeps the folder's handle in IndexedDB, and next time it asks the browser for
// that folder again — one click on "Reopen" if the browser wants a fresh permission, or no click at all
// when it has kept the permission. The handle never leaves the browser's storage. Other browsers
// (Firefox, Safari) don't have this API; canOpenFolder is false there and the buttons stay hidden.

// Minimal types for the parts used; TypeScript's DOM library doesn't ship all of them.
interface FileHandle { kind: 'file'; name: string; getFile(): Promise<File> }
export interface DirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FileHandle | DirHandle>;
  queryPermission(o: { mode: 'read' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'read' }): Promise<PermissionState>;
}
type Picker = (o?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirHandle>;

const picker = (): Picker | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker);
export const canOpenFolder = !!picker();

const DB = 'number-finder';
const STORE = 'handles';
const KEY = 'folder';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const q = indexedDB.open(DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore(STORE);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const saveFolderHandle = (h: DirHandle) => withStore('readwrite', s => s.put(h, KEY)).then(() => undefined);
export const forgetFolderHandle = () => withStore('readwrite', s => s.delete(KEY)).then(() => undefined);
export async function loadFolderHandle(): Promise<DirHandle | null> {
  try { return (await withStore<DirHandle | undefined>('readonly', s => s.get(KEY))) ?? null; } catch { return null; }
}

/** Ask the person for a folder. Null when they cancel. */
export async function pickFolder(): Promise<DirHandle | null> {
  const show = picker();
  if (!show) return null;
  try { return await show({ id: 'number-finder', mode: 'read' }); } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

/** Current read permission; with `ask`, prompts (needs a click) when it isn't granted yet. */
export async function folderPermission(h: DirHandle, ask: boolean): Promise<PermissionState> {
  let p = await h.queryPermission({ mode: 'read' });
  if (p === 'prompt' && ask) p = await h.requestPermission({ mode: 'read' });
  return p;
}

const skip = (name: string) => name.startsWith('.') || name.startsWith('~$');

/** Every file with one of the extensions, this folder and its subfolders (a few levels), at most `max`. */
export async function readFolder(h: DirHandle, extensions: string[], max = 500): Promise<File[]> {
  const out: File[] = [];
  const wanted = new Set(extensions.map(e => e.toLowerCase()));
  const walk = async (dir: DirHandle, depth: number) => {
    for await (const entry of dir.values()) {
      if (out.length >= max) return;
      if (skip(entry.name)) continue;
      if (entry.kind === 'directory') { if (depth < 4) await walk(entry, depth + 1); continue; }
      const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
      if (wanted.has(ext)) out.push(await entry.getFile());
    }
  };
  await walk(h, 0);
  return out;
}
