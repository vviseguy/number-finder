# Number finder

Find where the numbers in your tax documents come from. Drop in PDFs, Excel workbooks, and CSV files, then ask:

- **Where does this number appear?** — like XLOOKUP across every file (*Match: 1 number*).
- **Which numbers add up to it?** — sums of up to however many numbers you choose, or any sum, optionally letting some count as negative (a penalty that reduces interest, a credit shown as a positive).
- **Does my return tie out?** — *Check a group* traces every number in one group of files (your return) against another (your source documents) and lists what's found, what's made of several numbers, and what's missing — with the nearest number for anything missing, which is usually the typo.

## Open it

Double-click **`numberfinder.html`**. It opens in your browser and works offline. There's nothing to install.

## Your files stay on your computer

Everything happens inside that browser tab. The page includes a security rule (a Content-Security-Policy) that stops it from making any network connection at all, so documents can't be sent anywhere — you can check the rule at the top of the HTML file.

Between sessions it remembers your **setup** — group names, which file names belong to each group, files' short names, your searches, the order of results, the pane width, and the theme — but never the files or their contents, and not past versions of searches. Drop the files in again and they slot back into their groups.

## Using it

The three steps in the header, `1 Files → 2 Groups → 3 Find`, are the three views. The drop target sits at the right of the header, and the search bar under the header is on every view. The sun/moon button at the top right pins light or dark mode (it follows your system until you do). The handle between the results and the pane on the right drags to resize it.

1. **Files.** Drop files anywhere on the page, or use *choose files*. Each file shows how many numbers were found; click one to see it on the right. Long file names are shortened to what tells them apart: words that appear in every file's name are replaced by `…`, so *Alpha Client 2025 Bank Statement Jan.pdf* shows as `Alpha…Jan.pdf` next to its Beta and February siblings, with the full name underneath and in tooltips. The pencil sets your own short name instead, remembered for next time. A scanned PDF (an image with no text) is flagged; Number finder can't read scans yet.
2. **Groups.** A group is a set of files to search in, like *Source docs* or *2025 return*. A file can be in several groups. Each file in a group can have a limit on how many numbers a match may use from it: `1` (at most one), `0-2`, `1-2` (at least one), `2+`, or blank for any. Until you make a group, searches look through all files.
3. **Find.** Type a number in the search bar (or click any number in a preview) and press Enter; *in* picks the group to look in. The query stays in the bar, and selecting a search in the history loads it back. Under the bar:
   - **Match:** *1 number* (where does it appear?), *Sums of up to* a number you set (2 to 20), or *Any sum*. Exact matches of the number itself always show first.
   - **Rounding:** *Whole dollars* (±0.50 — returns round to dollars, so 3,234.56 matches 3,235), *Within 1 cent*, or *Exact*.
   - **Negatives:** *also try negatives* lets any number count as negative.

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
   | `3,235 sums:3` | sums of up to 3 numbers; `sums:any`, `sums:1` |
   | `3,235 ±0.50` or `~0.50` | within 50 cents; typing `+-` or `-+` in the bar turns into `±` |
   | `3,235 neg` | let numbers count as negative |

   Words like `in:`, `sums:`, `±`, and `neg` override the pills for that one search. Filters apply before the search, so a skipped number can never be part of a sum.

   **Order.** With several matches, the *Order* picker above the results offers *Best match* (fewest numbers, then the ones mentioning a `'word`, then fewest negatives, then closest), *Closest first*, *By file*, and *Document order*. It's remembered.

   **Whole group.** Type `check:"2025 return"` in the bar, or press *Check every number…* on the group's card in step 2, which types it for you. The right side then reads *against* `Source docs`: every number in the first group is looked up in the second, with the same Match, Rounding, and filter words. The result is a table of what was found, what's made of several numbers, and what's missing.

   **History and versions.** Searches and checks run side by side in the history; each shows its progress and can be stopped. Versions are automatic: searching the *same number* again with different settings or filters makes a new version of that search (so does a "try…" button under a miss); a *different* number is a new search; the identical search just shows the existing one. The bar above the results says which version you're on and when it ran; its picker shows every past version read-only, with *Back to current* and *Restore*.

   The pane on the right shows the selected number in its file. Hover any number, in the results or in a file, to light up every other place the same value appears; the yellow marks along the scrollbars show where those places are.

   **Sums** show closed: a title (*Sum of 3 amounts across W-2.pdf, 1099-INT.pdf and 1 other file*) with the equation along the bottom, `85,000.00 + 3,234.56 + 2,000.00 = 90,234.56`, trimmed to `…` if it's long so the total always shows. Open one for the full breakdown. A number counted as negative is written `−(265.44)`, with the grey minus and parentheses around the number as it appears in the file.

   **New search.** Click the title or step 3 (or press Search with the bar empty) to clear the bar: the history stays, and with no files loaded you get a prompt to add some.

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

`npm run build` writes the single self-contained file to `dist/numberfinder.html`. `npm run e2e` runs the browser tests against that built file in Microsoft Edge and saves screenshots to `test-results/shots/`. `node scripts/make-fixtures.mjs` and `node scripts/make-payroll-fixture.mjs` regenerate the fake tax documents in `fixtures/` used by the tests.

| Path | What |
| --- | --- |
| `src/types.ts` | Contracts shared by extraction, the engine, and the UI |
| `src/extract/` | Reads PDFs (pdf.js), Excel and CSV (SheetJS): amounts, labels, locations |
| `src/engine/` | The search: exact lookups, combinations, negatives, per-file limits, nearest number; runs in background workers |
| `src/lib/query.ts`, `fuzzy.ts`, `rank.ts` | The bar's grammar, the `~word` matcher, and the orders results can be shown in |
| `src/state/store.ts` | App state, actions, and what's remembered between sessions |
| `src/ui/` | The interface |
| `e2e/` | Browser tests of the built file |
