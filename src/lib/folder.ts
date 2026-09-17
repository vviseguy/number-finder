// Open a folder of documents (Chromium's File System Access API: Edge, Chrome), for this session only.
// The folder is read once and forgotten when the tab closes: nothing about it is kept. Other browsers
// (Firefox, Safari) don't have this API; canOpenFolder is false there and the button stays hidden.

// Minimal types for the parts used; TypeScript's DOM library doesn't ship all of them.
interface FileHandle { kind: 'file'; name: string; getFile(): Promise<File> }
export interface DirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FileHandle | DirHandle>;
}
type Picker = (o?: { mode?: 'read' | 'readwrite' }) => Promise<DirHandle>;

const picker = (): Picker | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { showDirectoryPicker?: Picker }).showDirectoryPicker);
export const canOpenFolder = !!picker();

/** Ask the person for a folder, read-only. Null when they cancel. */
export async function pickFolder(): Promise<DirHandle | null> {
  const show = picker();
  if (!show) return null;
  try { return await show({ mode: 'read' }); } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

const skip = (name: string) => name.startsWith('.') || name.startsWith('~$');

/** Every file with one of the extensions, this folder and its subfolders (`maxDepth` levels down), at most `max`. */
export async function readFolder(h: DirHandle, extensions: string[], max = 500, maxDepth = 4): Promise<File[]> {
  const out: File[] = [];
  const wanted = new Set(extensions.map(e => e.toLowerCase()));
  const walk = async (dir: DirHandle, depth: number) => {
    for await (const entry of dir.values()) {
      if (out.length >= max) return;
      if (skip(entry.name)) continue;
      if (entry.kind === 'directory') { if (depth < maxDepth) await walk(entry, depth + 1); continue; }
      const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
      if (wanted.has(ext)) out.push(await entry.getFile());
    }
  };
  await walk(h, 0);
  return out;
}
