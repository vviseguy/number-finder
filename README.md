# Number finder

Find where the numbers in your tax documents come from. Drop in PDFs, Excel workbooks, and CSV files, then ask:

- **Where does this number appear?** — like XLOOKUP across every file (*Match: 1 number*).
- **Which numbers add up to it?** — sums of up to however many numbers you choose, or any sum, optionally letting some count as negative (a penalty that reduces interest, a credit shown as a positive).
- **Does my return tie out?** — *Check a group* traces every number in one group of files (your return) against another (your source documents) and lists what's found, what's made of several numbers, and what's missing — with the nearest number for anything missing, which is usually the typo.

## Open it

Go to **https://vviseguy.github.io/number-finder/**, or double-click **`numberfinder.html`** to use it offline. There's nothing to install either way. The website's *Download for offline use* button (on the Files view) saves that one file.

The website is the same single file, published from this private repository on every push to `main` by `.github/workflows/pages.yml`; only the built page is public, not the source. Your documents are still read only inside your browser tab: the same no-network rule applies on the website.

## Your files stay on your computer

Everything happens inside that browser tab. The page includes a security rule (a Content-Security-Policy) that stops it from making any network connection at all, so documents can't be sent anywhere — you can check the rule at the top of the HTML file.

Between sessions it remembers your **setup** — group names, which file names belong to each group, files' short names, your searches, the order of results, the pane width, and the theme — but never the files or their contents, and not past versions of searches. Drop the files in again and they slot back into their groups.

**Getting the files back without dropping them.** A browser never lets a page read files from disk on its own, so there are two helpers on the Files view:

- **Open folder…** (Edge and Chrome) reads every PDF, Excel, and CSV file in a folder and its subfolders, and remembers the folder. Next time, the page reads it again by itself if the browser has kept the permission, and otherwise shows a *Reopen folder* button that takes one click. The folder's handle is kept in the browser's own storage on this computer; the files are read fresh each time and never stored. *Forget folder* drops it.
- **Save setup** writes `Number finder setup.json` — the groups, short names, options, and searches, not the documents — and **Load setup…** reads one back. Dropping the file anywhere on the page does the same, so a setup can travel with a folder of documents or be handed to someone else.
- **The two together.** With a folder open, *Save setup* opens the Save dialog in that folder, and a setup file kept there loads with the folder: when the folder is opened or reopened, the newest setup file in it (top level or one folder down) is loaded if it's newer than the setup this computer remembers. An older one is left alone, with a note saying so; *Load setup…* uses it anyway. So the folder becomes the whole job: documents plus setup, ready on any computer.

## Using it

The three steps in the header, `1 Files → 2 Groups → 3 Find`, are the three views; switching between them keeps whatever is loaded in the search area. The drop target sits at the right of the header, and the search bar under the header is on every view. The sun/moon button at the top right pins light or dark mode (it follows your system until you do); light mode is a warm paper tone rather than pure white. The handle between the results and the pane on the right drags to resize it; the page in the pane scales while you drag and is drawn again once you let go.

1. **Files.** Drop files anywhere on the page, or use *choose files*. Each file shows how many numbers were found; click one to see it on the right. Long file names are shortened to what tells them apart: words that appear in every file's name are replaced by `…`, so *Alpha Client 2025 Bank Statement Jan.pdf* shows as `Alpha…Jan.pdf` next to its Beta and February siblings, with the full name underneath and in tooltips. The pencil sets your own short name instead, remembered for next time. A scanned PDF (an image with no text) is flagged; Number finder can't read scans yet.
2. **Groups.** A group is a set of files to search in, like *Source docs* or *2025 return*. A file can be in several groups. Each file in a group can have a limit on how many numbers a match may use from it: `1` (at most one), `0-2`, `1-2` (at least one), `2+`, or blank for any. Until you make a group, searches look through all files.
3. **Find.** Type a number in the search bar (or click any number in a preview) and press Enter; *in* picks the group to look in. The query stays in the bar, and selecting a search in the history loads it back. Under the bar:
   - **Match:** *to number* (where does it appear?), *to sum (Any count)*, *to sum (Up to count)* with a count you set (2 to 20), or *to sum (Specify count)* for exactly that many. Exact matches of the number itself show first, except with a specified count, which leaves single numbers out.
   - **Time limit** (sums only): how long a sum search may run: 10 s, 30 s (the default), 2 min, 10 min, or *No limit*, which runs until it has tried everything or you press Stop. While it runs, the results show how long it has been going, the matches so far, and a Stop button. A search that stops early says why, with *Search again for 2 min* (the next longer limit) and ways to narrow it; either one runs as a new version. For a group check the pill reads *Time per number*: each number in the group gets that long.
   - **Before you search:** when a sum search is too big to finish in its time limit, or big enough that sums will match the number by coincidence, a note under the bar says so and offers one-click ways to narrow it: *Sums of up to 3*, *At most 1 negative*, *Negatives off*, or a smaller group. The estimate is rough on purpose, but it gets the scale right: seconds versus a lifetime, a stray coincidence versus so many that a match proves little.
   - **Search mode** (sums only): which groupings come first. *Clumped* puts numbers next to each other in one file on top; *Spread (within files)* prefers one file but numbers far apart in it; *Across files*, the default, prefers one number from each file, like a return line built from several source documents. Sums collect more matches than they show first, so the mode has real choices; a group check ranks each row's matches the same way.
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
   | `3,235 in:Source` | look in the group whose name starts with "Source" (quotes for spaces) |
   | `check:"2025 return"` | look up every number in that group (see below) |
   | `3,235 sums:3` | sums of up to 3 numbers; `sums:=3` exactly 3; `sums:2..4` between 2 and 4; `sums:2+` at least 2; `sums:any`; `sums:1` |
   | `3,235 ±0.50` or `~0.50` | within 50 cents; typing `+-` or `-+` in the bar turns into `±` |
   | `3,235 neg` | let numbers count as negative; `neg:1` at most one of them; `neg:0` none |
   | `3,235 sums:3 mode:clumped` | search mode for sums: `mode:clumped`, `mode:spread`, `mode:across` |
   | `3,235 sums:any time:5m` | how long a sum search may run: `time:45s`, `time:5m`, `time:1h`, `time:none` |

   Words like `in:`, `sums:`, `±`, and `neg` override the pills for that one search. Filters apply before the search, so a skipped number can never be part of a sum.

   **Order.** With several matches, the *Order* picker above the results offers *Best match* (fewest numbers, then the ones mentioning a `'word`, then fewest negatives, then closest), *Closest first*, *By file*, and *Document order*. It's remembered.

   **Whole group.** Type `check:"2025 return"` in the bar, or press *Check every number…* on the group's card in step 2, which types it for you. The right side then reads *against* `Source docs`: every number in the first group is looked up in the second, with the same Match, Rounding, and filter words. The result is a table of what was found, what's made of several numbers, and what's missing.

   **History and versions.** Searches and checks run side by side in the history; each shows its progress and can be stopped. Versions are automatic: searching the *same number* again with different settings or filters makes a new version of that search (so does a "try…" button under a miss); a *different* number is a new search; the identical search just shows the existing one. The bar above the results says which version you're on and when it ran; its picker shows every past version read-only, with *Back to current* and *Restore*.

   The pane on the right shows the selected number in its file. Hover any number, in the results or in a file, to light up every other place the same value appears; the yellow marks along the scrollbars show where those places are.

   **Sums** show closed: a title (*Sum of 3 amounts across W-2.pdf, 1099-INT.pdf and 1 other file*) with the equation along the bottom, `85,000.00 + 3,234.56 + 2,000.00 = 90,234.56`, trimmed to `…` if it's long so the total always shows. Open one for the full breakdown. A number counted as negative is written `−(265.44)`, with the grey minus and parentheses around the number as it appears in the file.

   **Empty bar.** Clear the bar (the × in it) and press Enter: the history stays with nothing selected, and with no files loaded you get a prompt to add some.

**What counts as a number:** amounts like `85,000.00`, `$3,234.56`, `(265.44)`, `3,235`. Years, box and line labels (`1`, `2a`, `25a`), form names (`Form 1040`), SSNs, EINs, ZIP codes, dates, percentages, and long account numbers are skipped. Open a file's preview to see exactly which numbers were picked up — each one is clickable.

**Export:** a group check can be saved as a formatted Excel workbook or a CSV.

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
| `src/lib/setupfile.ts`, `folder.ts` | The setup file format; the remembered folder (File System Access API) |
| `src/state/store.ts` | App state, actions, and what's remembered between sessions |
| `src/ui/` | The interface |
| `e2e/` | Browser tests of the built file |
