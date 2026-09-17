// The build-time half of "nothing is saved" (see src/lib/no-storage.ts for the runtime half):
//   1. every entry point — the page and each worker — starts by importing no-storage;
//   2. no other source file names a browser storage API;
//   3. every form field tells the browser not to remember what was typed (autocomplete="off").
// The browser tests add the third half: after a full session, the browser's storage is read and must be empty.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const LOCK = path.join(SRC, 'lib', 'no-storage.ts');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/');
const read = (p: string) => readFileSync(p, 'utf8');
/** Source without comments, so an explanation can mention an API without tripping the check. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const FILES = sourceFiles(SRC);

/** Every way a page or worker can keep data in the browser, or put something in the tab's saved history. */
const STORAGE_API = new RegExp([
  String.raw`\b(localStorage|sessionStorage|indexedDB|IDBFactory|caches|CacheStorage|cookieStore|openDatabase)\b`,
  String.raw`\b(webkitRequestFileSystem|webkitResolveLocalFileSystemURL|storageBuckets|serviceWorker)\b`,
  String.raw`\b(showSaveFilePicker|createWritable|createSyncAccessHandle|removeEntry|pushState|replaceState)\b`,
  String.raw`document\.cookie|navigator\.storage|location\.hash\s*=|\bwindow\.name\b|create:\s*true`,
].join('|'));

describe('nothing is saved', () => {
  test('the page and every worker import no-storage before anything else', () => {
    const workers = FILES.flatMap(f => [...read(f).matchAll(/from\s+['"](\.[^'"]+)\?worker[^'"]*['"]/g)].map(m => path.resolve(path.dirname(f), m[1])));
    const entries = [path.join(SRC, 'main.tsx'), ...new Set(workers)];
    expect(entries.map(rel)).toEqual(['main.tsx', 'engine/worker.ts', 'lib/pdf-worker.ts']);
    for (const entry of entries) {
      const first = /^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/m.exec(code(read(entry)));
      expect(first && path.resolve(path.dirname(entry), first[1]), `${rel(entry)} must start with import of lib/no-storage`).toBe(LOCK.replace(/\.ts$/, ''));
    }
  });

  test('no other source file names a storage API', () => {
    const hits = FILES.filter(f => f !== LOCK).flatMap(f =>
      code(read(f)).split('\n').flatMap((line, i) => (STORAGE_API.test(line) ? [`${rel(f)}:${i + 1}: ${line.trim()}`] : [])));
    expect(hits).toEqual([]);
  });

  test('the check itself catches each API it looks for', () => {
    for (const line of ['localStorage.setItem(k, v)', 'await indexedDB.open(x)', 'caches.open(n)', 'document.cookie = c', 'navigator.storage.getDirectory()',
      'history.pushState(s, t)', 'location.hash = q', 'window.name = s', 'dir.getFileHandle(n, { create: true })', 'h.createWritable()', 'sessionStorage[k]']) {
      expect(STORAGE_API.test(line), line).toBe(true);
    }
    expect(STORAGE_API.test('sortCache.out')).toBe(false);
    expect(code("// localStorage is off\nconst a = 1; // uses indexedDB\nconst url = 'https://x';")).not.toMatch(STORAGE_API);
  });

  test('every form field has autocomplete="off", so the browser keeps no record of what was typed', () => {
    const missing: string[] = [];
    for (const f of FILES.filter(p => p.endsWith('.tsx'))) {
      const text = code(read(f));
      for (const m of text.matchAll(/<(input|select|textarea)\b/g)) {
        const end = m[1] === 'input' ? text.indexOf('/>', m.index) : text.indexOf(`</${m[1]}>`, m.index);
        const tag = text.slice(m.index, end);
        if (!/autoComplete="off"/.test(tag)) missing.push(`${rel(f)}:${text.slice(0, m.index).split('\n').length}: <${m[1]}>`);
      }
    }
    expect(missing).toEqual([]);
  });
});
