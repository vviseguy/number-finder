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
// One exception, in the page only and before storage is turned off: whatever an OLDER version of Number
// finder saved in this browser is deleted. Every name it has ever used starts "number-finder" (the setup
// under four key names, the theme, the pane width, and one database), so the sweep takes anything by that
// name out of local storage, session storage, IndexedDB and the cache store, and says in the console what
// it removed. It deliberately stops there rather than clearing the whole origin: pages opened from disk
// share one storage area with every other local page, and the website shares one with everything else
// published at the same address, so a blanket wipe would delete other people's — or your own — unrelated data.

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

/** Every name Number finder has ever saved anything under. */
const OURS = /^number-?finder/i;
const removed = (what: string, name: string) => console.info(`Number finder: removed ${what} "${name}", left by an older version.`);

/**
 * Deletes anything an older version of Number finder saved in this browser, by name (see the note above).
 * The page only, and before lockStorage turns these APIs off.
 */
export function removeOlderSaves(g: Global): void {
  for (const where of ['localStorage', 'sessionStorage'] as const) {
    try {
      const store = g[where] as Storage | undefined;
      if (!store) continue;
      // Listed first, then removed: removing while walking the list by index can skip a key.
      const ourKeys = () => Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => !!k && OURS.test(k));
      for (const key of ourKeys()) { store.removeItem(key); removed(where, key); }
      const left = ourKeys();
      if (left.length) console.warn(`Number finder: ${left.join(', ')} could not be removed from ${where}.`);
    } catch { /* unavailable here: nothing of ours can be in it */ }
  }
  try {
    const idb = g.indexedDB as IDBFactory | undefined;
    void idb?.databases?.().then(list => {
      for (const db of list) if (db.name && OURS.test(db.name)) { idb.deleteDatabase(db.name); removed('database', db.name); }
    }).catch(() => { /* nothing to delete */ });
  } catch { /* nothing to delete */ }
  try {
    const store = g.caches as CacheStorage | undefined;
    void store?.keys().then(names => {
      for (const name of names) if (OURS.test(name)) void store.delete(name).then(() => removed('cache', name));
    }).catch(() => { /* nothing to delete */ });
  } catch { /* nothing to delete */ }
}

const self_ = globalThis as Global;
if (typeof self_.document === 'object') removeOlderSaves(self_);
lockStorage(self_);
