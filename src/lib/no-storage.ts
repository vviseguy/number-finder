// NOTHING IS SAVED. Number finder keeps everything in memory: close or reload the tab and it's gone.
//
// This module turns off every way a web page can keep data in the browser, so neither this app nor a
// library bundled into it can carry anything from one session to the next. It is the FIRST import of
// every entry point: the page (src/main.tsx) and each worker (every file loaded with `?worker`).
// src/lib/no-storage.test.ts fails the build if an entry point doesn't start with it, if any other
// source file names a storage API, or if a form field lets the browser remember what was typed.
//
// Turned off (touching one throws a SecurityError that says why):
//   localStorage, sessionStorage, indexedDB, caches, cookieStore, WebSQL, the old FileSystem API,
//   navigator.storage (including the origin private file system), navigator.storageBuckets, service
//   workers, history.pushState and replaceState, window.open, showSaveFilePicker, and every way to write
//   through a file handle (createWritable, createSyncAccessHandle, remove, move, removeEntry, and
//   getFileHandle / getDirectoryHandle with create).
//   document.cookie always reads '' and refuses writes; window.name always reads '' and ignores writes.
// Frames: a frame has its own copy of all of these, so they're turned off in a frame too when its
//   contentWindow or contentDocument is reached. A script reaching a frame only through window[0] would
//   get around that; nothing in Number finder makes frames, and the browser test that reads the browser's
//   storage after a full session (e2e/app.spec.ts, "after a full session…") is the independent check.
//
// One exception, in the page only and before storage is turned off: what OLDER versions of Number finder
// saved is deleted — localStorage keys starting "number-finder:" and the IndexedDB database
// "number-finder". Nothing else is read, and nothing is written.

type Global = typeof globalThis & Record<string, unknown>;
type Proto = Record<string, unknown>;

const WHY = 'is turned off: Number finder keeps everything in memory and saves nothing in the browser.';
const refuse = (what: string) => (): never => { throw new DOMException(`${what} ${WHY}`, 'SecurityError'); };

/** Properties of the global object. */
const GLOBALS = [
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'cookieStore', 'openDatabase',
  'webkitRequestFileSystem', 'webkitResolveLocalFileSystemURL', 'showSaveFilePicker',
];

/** Properties of interface prototypes: [interface, property]. */
const PROTOTYPE_PROPS: [string, string][] = [
  ['Navigator', 'storage'], ['Navigator', 'storageBuckets'], ['Navigator', 'serviceWorker'],
  ['WorkerNavigator', 'storage'], ['WorkerNavigator', 'storageBuckets'],
  ['History', 'pushState'], ['History', 'replaceState'],
  ['FileSystemFileHandle', 'createWritable'], ['FileSystemFileHandle', 'createSyncAccessHandle'],
  ['FileSystemHandle', 'remove'], ['FileSystemHandle', 'move'], ['FileSystemDirectoryHandle', 'removeEntry'],
];

/** Redefines a property for good (not configurable). False when the browser doesn't allow it. */
function define(target: object, name: string, desc: PropertyDescriptor): boolean {
  try {
    Object.defineProperty(target, name, { ...desc, configurable: false });
    return true;
  } catch {
    return false; // already turned off, or not redefinable
  }
}

const protoOf = (g: Global, iface: string): Proto | undefined => (g[iface] as { prototype?: Proto } | undefined)?.prototype;

/** Turns storage off in a window, a frame's window, or a worker. Safe to call more than once. */
export function lockStorage(g: Global): void {
  for (const name of GLOBALS) if (name in g) define(g, name, { get: refuse(name), set: refuse(name) });

  for (const [iface, name] of PROTOTYPE_PROPS) {
    const proto = protoOf(g, iface);
    if (proto && name in proto) define(proto, name, { get: refuse(`${iface === 'WorkerNavigator' ? 'navigator' : iface}.${name}`) });
  }

  // Opening an existing file or folder through a handle is fine; creating one is a write.
  const dir = protoOf(g, 'FileSystemDirectoryHandle');
  for (const name of ['getFileHandle', 'getDirectoryHandle']) {
    const original = dir?.[name];
    if (typeof original !== 'function') continue;
    define(dir!, name, {
      value(this: unknown, entry: string, options?: { create?: boolean }) {
        if (options?.create) refuse(`${name} with create`)();
        return (original as (e: string, o?: object) => unknown).call(this, entry, options);
      },
    });
  }

  const doc = protoOf(g, 'Document');
  if (doc && 'cookie' in doc) define(doc, 'cookie', { get: () => '', set: refuse('document.cookie') });

  if (typeof g.document === 'object' && g.document) {
    try { (g as unknown as { name: string }).name = ''; } catch { /* not settable */ } // drop anything an earlier page in this tab left
    define(g, 'name', { get: () => '', set: () => {} });
    if (typeof g.open === 'function') define(g, 'open', { value: refuse('window.open') });
  }

  // A frame's window gets its own copy of every API above: turn them off there as soon as it's reached.
  for (const iface of ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLObjectElement']) {
    const proto = protoOf(g, iface);
    if (!proto) continue;
    for (const name of ['contentWindow', 'contentDocument']) {
      const get = Object.getOwnPropertyDescriptor(proto, name)?.get;
      if (!get) continue;
      define(proto, name, {
        get(this: object) {
          const value = get.call(this) as (Global & { defaultView?: Global }) | null;
          const inner = name === 'contentWindow' ? value : value?.defaultView;
          if (inner) { try { lockStorage(inner); } catch { /* a cross-origin frame: its storage isn't this page's */ } }
          return value;
        },
      });
    }
  }
}

/** Deletes what older versions of Number finder saved (their names only). Page only; call before lockStorage. */
export function removeOlderSaves(g: Global): void {
  try {
    const ls = g.localStorage as Storage | undefined;
    if (ls) {
      for (let i = ls.length - 1; i >= 0; i--) {
        const key = ls.key(i);
        if (key?.startsWith('number-finder:')) ls.removeItem(key);
      }
    }
  } catch { /* storage unavailable: nothing to delete */ }
  try {
    const idb = g.indexedDB as IDBFactory | undefined; // kept here: it's turned off right after this
    void idb?.databases?.()
      .then(list => { if (list.some(d => d.name === 'number-finder')) idb.deleteDatabase('number-finder'); })
      .catch(() => { /* nothing to delete */ });
  } catch { /* nothing to delete */ }
}

const self_ = globalThis as Global;
if (typeof self_.document === 'object') removeOlderSaves(self_);
lockStorage(self_);
