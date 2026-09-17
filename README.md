# Number finder

Find where the numbers in your tax documents come from. Drop in PDFs, Excel workbooks, and CSV files, then ask:

- **Where does this number appear?** — like XLOOKUP across every file (*Match: to number*).
- **Which numbers add up to it?** — sums of up to however many numbers you choose, or any sum, optionally letting some count as negative (a penalty that reduces interest, a credit shown as a positive).
- **Does my return tie out?** — `check:` traces every number in some files (your return) against the other files (your source documents) and lists what's found, what's made of several numbers, and what's missing — with the nearest number for anything missing, which is usually the typo.

## Open it

Go to **https://vviseguy.github.io/number-finder/**, or double-click **`numberfinder.html`** to use it offline. There's nothing to install either way.

The website is the same single file, published from this private repository on every push to `main` by `.github/workflows/pages.yml`; only the built page is public, not the source. Your documents are still read only inside your browser tab: the same no-network rule applies on the website.

## Nothing is saved

Everything Number finder knows lives in the memory of one browser tab: the documents, the numbers read from them, short names, which files are ticked, options, searches, results, the theme, and the pane width. Close or reload the tab and all of it is gone; the next visit starts empty. There is no setup file, no remembered folder, and no history between sessions.

The only things that leave the tab are files you ask for: *Export to Excel* and *CSV* on a check. They go to your Downloads folder like any other download.

**The network.** The page carries a security rule (a Content-Security-Policy, at the top of the HTML file) that blocks requests to anywhere: no scripts, fonts, images, or data are fetched, so neither the page nor a library in it can send a document out. The rule doesn't cover a script that deliberately navigates the tab to another address or opens a WebRTC connection; no code in Number finder does either.

### How to audit it

Five independent checks, from reading the code to watching the browser:

1. **The lock.** [`src/lib/no-storage.ts`](src/lib/no-storage.ts) runs before anything else in the page and in each background worker, and turns off every way a page can keep data in the browser: `localStorage`, `sessionStorage`, IndexedDB, the Cache API, cookies, the origin private file system, storage buckets, service workers, `history.pushState`, `window.name`, `window.open`, and writing through file handles. Touching any of them throws an error that says *"…is turned off: Number finder keeps everything in memory and saves nothing in the browser."* It also turns them off inside any frame that's reached through the page.
2. **The source check.** `npm test` runs [`src/lib/no-storage.test.ts`](src/lib/no-storage.test.ts), which fails if the page or any worker doesn't load the lock first, if any other source file names a storage API, or if any form field lacks `autocomplete="off"` (which keeps the browser from recording what was typed, including in crash-recovery data).
3. **The browser check.** `npm run e2e` includes three tests in [`e2e/app.spec.ts`](e2e/app.spec.ts): every storage API above is off in the page and in a frame; after a full session (files, short names, unticked files, theme, searches, a check, a resized pane, text in the bar) the browser's `localStorage`, `sessionStorage`, IndexedDB, Cache Storage, file system, cookies, and `window.name` are all empty, and a reload starts from scratch; and data saved by older versions is deleted (below). These were checked against a broken build: with the lock taken out, the first test fails, and with one write to storage added, the second fails too.
4. **The website.** `node scripts/audit-live.mjs` opens the website copy in Edge, uses it (files, searches, the theme), then asks the browser what the site stored: no cookies, no local storage, no IndexedDB, and a reload starts empty.
5. **By hand, in the page.** Open the browser's developer tools on Number finder. In the Console, `localStorage` or `indexedDB` answers with the "turned off" error. Under Application → Storage, the page's local storage, session storage, IndexedDB, and cookies stay empty however much you use it.

In the built file, the words `localStorage`, `sessionStorage`, and `indexedDB` appear only inside the lock (once for the page and once per worker) and in a read-only check in ExcelJS, the export library, which the lock turns into "not available".

**Data from older versions.** Versions before this one remembered the setup in the browser. When the page opens, it deletes those: every `localStorage` key starting `number-finder:` and the IndexedDB database `number-finder`. Nothing else is read or touched.

**What the browser itself keeps**, outside the page's control: the list of downloads, the folder the file picker last opened, the page's address in your browsing history (no document data is ever in the address), and, for the website, a cached copy of the page itself. A private window keeps none of these after it closes.

## Using it

It's one screen: the search bar across the top, the history and results below it, and the file you're looking at on the right. The sun/moon button at the top right pins light or dark mode for this visit (each visit starts by following your system); light mode is a warm paper tone rather than pure white. The handle between the results and the pane on the right drags to resize it; the page in the pane scales while you drag and is drawn again once you let go.

1. **Add files.** Drop PDFs, Excel workbooks, and CSV files anywhere on the page, or use *choose files* at the top right. *Open folder…* (Edge and Chrome) reads every such file in a folder and its subfolders.
2. **Pick the files to search.** The *in* button at the right of the search bar opens the file list. Every file is ticked to begin with (*All files*, which includes files you add later); untick the ones to leave out, or use *Select all* and *Select none*. The button says what's picked: *All files*, one file's name, or *2 of 4 files*.
   Each file in the list shows what was read from it (*PDF · 1 page · 4 numbers*) and any problem, like a scan with no readable numbers. Click its name to see it on the right; every number there is clickable. Long file names are shortened to what tells them apart: words that appear in every file's name are replaced by `…`, so *Alpha Client 2025 Bank Statement Jan.pdf* shows as `Alpha…Jan.pdf` next to its Beta and February siblings, with the full name underneath and in tooltips. The pencil sets your own short name instead, for this session. The other two buttons check every number in the file (below) and remove it.
3. **Search.** Type a number in the search bar (or click any number in a preview) and press Enter. The query stays in the bar, and selecting a search in the history loads it back. Under the bar:
   - **Match:** *to number* (where does it appear?), *to sum (Any count)*, *to sum (Up to count)* with a count you set (2 to 20), or *to sum (Specify count)* for exactly that many. Exact matches of the number itself show first, except with a specified count, which leaves single numbers out.
   - **Time limit** (sums only): how long a sum search may run: 10 s, 30 s (the default), 2 min, 10 min, or *No limit*, which runs until it has tried everything or you press Stop. While it runs, the results show how long it has been going, the matches so far, and a Stop button. A search that stops early says why, with *Search again for 2 min* (the next longer limit) and ways to narrow it; either one runs as a new version. For a check the pill reads *Time per number*: each number being checked gets that long.
   - **Before you search:** when a sum search is too big to finish in its time limit, or big enough that sums will match the number by coincidence, a note under the bar says so and offers one-click ways to narrow it: *Sums of up to 3*, *At most 1 negative*, or *Negatives off*; ticking fewer files helps too. The estimate is rough on purpose, but it gets the scale right: seconds versus a lifetime, a stray coincidence versus so many that a match proves little.
   - **Search mode** (sums only): which groupings come first. *Clumped* puts numbers next to each other in one file on top; *Spread (within files)* prefers one file but numbers far apart in it; *Across files*, the default, prefers one number from each file, like a return line built from several source documents. Sums collect more matches than they show first, so the mode has real choices; a check ranks each row's matches the same way.
   - **Rounding:** *Whole dollars* (±0.50 — returns round to dollars, so 3,234.56 matches 3,235), *Within 1 cent*, or *Exact*.
   - **Negatives:** *off*, *on* (any number of them may count as negative), or *up to* a number you set, so a sum can use one penalty but not turn half the numbers around.

   **The bar's grammar** (the empty bar shows these in turn). Words are matched against a number's label, its column and sheet, and its file name, never minding case:
   | Type | Means |
   | --- | --- |
   | `3,235 85,000` | two numbers, two searches |
   | `3,200..3,300` | every number in a range |
   | `3,235 interest` | only numbers that mention "interest" |
   | `3,235 "box 1"` | quotes: only numbers that mention exactly this phrase; `"1099"` is text, not an amount |
   | `3,235 -hours` | skip numbers that mention "hours"; `-"hourly rate"` skips a phrase |
   | `3,235 ~intrest` | `~` allows a small typo: one wrong, missing, or extra letter from 4 letters, two from 8; `~1099int` finds "1099-INT" |
   | `3,235 '2025` | `'` reads 2025 as text instead of an amount, and lists the numbers that mention it first (it doesn't filter); `-'2025` skips them |
   | `3,235 in:1099` | look only in files named like that, instead of the ticked ones: a whole name (`in:W-2`), the start of names (`in:1099` is both 1099s), or part of one; use it more than once for more files; quotes for spaces |
   | `check:1040` | look up every number in the files named like that, against the other files (see below) |
   | `3,235 sums:3` | sums of up to 3 numbers; `sums:=3` exactly 3; `sums:2..4` between 2 and 4; `sums:2+` at least 2; `sums:any`; `sums:1` |
   | `3,235 ±0.50` or `~0.50` | within 50 cents; typing `+-` or `-+` in the bar turns into `±` |
   | `3,235 neg` | let numbers count as negative; `neg:1` at most one of them; `neg:0` none |
   | `3,235 sums:3 mode:clumped` | search mode for sums: `mode:clumped`, `mode:spread`, `mode:across` |
   | `3,235 sums:any time:5m` | how long a sum search may run: `time:45s`, `time:5m`, `time:1h`, `time:none` |

   Words like `in:`, `sums:`, `±`, and `neg` override the file list and the pills for that one search. Filters apply before the search, so a skipped number can never be part of a sum.

   **Order.** With several matches, the *Order* picker above the results offers *Best match* (fewest numbers, then the ones mentioning a `'word`, then fewest negatives, then closest), *Closest first*, *By file*, and *Document order*.

   **Checking every number.** Type `check:1040` in the bar, or press the check button next to a file in the file list, which types `check:"1040 draft.pdf"` for you; pressing it on another file adds that file too. The *in* button then reads *against*: every number in the files being checked is looked up in the other ticked files, with the same Match, Rounding, and filter words. The result is a table of what was found, what's made of several numbers, and what's missing.

   **History and versions.** Searches and checks run side by side in the history; each shows its progress and can be stopped. Versions are automatic: searching the *same number* again with different settings or filters makes a new version of that search (so does a "try…" button under a miss); a *different* number is a new search; the identical search just shows the existing one. The bar above the results says which version you're on and when it ran; its picker shows every past version read-only, with *Back to current* and *Restore*.

   The pane on the right shows the selected number in its file. Hover any number, in the results or in a file, to light up every other place the same value appears; the yellow marks along the scrollbars show where those places are.

   **Sums** show closed: a title (*Sum of 3 amounts across W-2.pdf, 1099-INT.pdf and 1 other file*) with the equation along the bottom, `85,000.00 + 3,234.56 + 2,000.00 = 90,234.56`, trimmed to `…` if it's long so the total always shows. Open one for the full breakdown. A number counted as negative is written `−(265.44)`, with the grey minus and parentheses around the number as it appears in the file.

   **Empty bar.** Clear the bar (the × in it) and press Enter: the history stays with nothing selected, and with no files loaded you get a prompt to add some.

**What counts as a number:** amounts like `85,000.00`, `$3,234.56`, `(265.44)`, `3,235`. Years, box and line labels (`1`, `2a`, `25a`), form names (`Form 1040`), SSNs, EINs, ZIP codes, dates, percentages, and long account numbers are skipped. Open a file's preview to see exactly which numbers were picked up — each one is clickable.

**Export:** a check can be saved as a formatted Excel workbook or a CSV.

## Development

Requires Node.js 22+.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build
```

`npm run build` writes the single self-contained file to `dist/numberfinder.html`. `npm run e2e` runs the browser tests against that built file in Microsoft Edge and saves screenshots to `test-results/shots/`. `node scripts/make-fixtures.mjs` and `node scripts/make-payroll-fixture.mjs` regenerate the fake tax documents in `fixtures/` used by the tests. `node scripts/bench-engine.mts` times the search engine against the size estimate behind the "Big search" note; the estimate's speed constant should stay just under the slowest rate it reports.

| Path | What |
| --- | --- |
| `src/types.ts` | Contracts shared by extraction, the engine, and the UI |
| `src/extract/` | Reads PDFs (pdf.js), Excel and CSV (SheetJS): amounts, labels, locations |
| `src/engine/` | The search: exact lookups, combinations, negatives, per-file limits, nearest number; runs in background workers |
| `src/lib/query.ts`, `fuzzy.ts`, `rank.ts` | The bar's grammar, the `~word` matcher, and the orders results can be shown in |
| `src/lib/no-storage.ts` | Turns the browser's storage off in the page and every worker (see *Nothing is saved*) |
| `src/lib/folder.ts` | *Open folder…* (File System Access API), for the current session only |
| `src/state/store.ts` | App state and actions, all in memory |
| `src/ui/` | The interface |
| `e2e/` | Browser tests of the built file |
