# Number finder

Find where the numbers in your tax documents come from. Drop in PDFs, Excel workbooks, and CSV files, then ask:

- **Where does this number appear?** — like XLOOKUP across every file (*Match: 1 number*).
- **Which numbers add up to it?** — sums of up to however many numbers you choose, or any sum, optionally letting some count as negative (a penalty that reduces interest, a credit shown as a positive).
- **Does my return tie out?** — *Check a group* traces every number in one group of files (your return) against another (your source documents) and lists what's found, what's made of several numbers, and what's missing — with the nearest number for anything missing, which is usually the typo.

## Open it

Double-click **`numberfinder.html`**. It opens in your browser and works offline. There's nothing to install.

## Your files stay on your computer

Everything happens inside that browser tab. The page includes a security rule (a Content-Security-Policy) that stops it from making any network connection at all, so documents can't be sent anywhere — you can check the rule at the top of the HTML file.

Between sessions it remembers your **setup** — group names, which file names belong to each group, and your searches — but never the files or their contents. Drop the files in again and they slot back into their groups.

## Using it

1. **Files.** Drop files anywhere on the page, or use *Choose files*. Each file shows how many numbers were found. A scanned PDF (an image with no text) is flagged; Number finder can't read scans yet.
2. **Groups.** A group is a set of files to search in, like *Source docs* or *2025 return*. A file can be in several groups. Each file in a group can have a limit on how many numbers a match may use from it: `1` (at most one), `0-2`, `1-2` (at least one), `2+`, or blank for any. Until you make a group, searches look through all files.
3. **Find a number.** Type it (or click any number in a preview), pick the group, and choose:
   - **Match:** *1 number* (where does it appear?), *Sums of up to N* (set N from 2 to 20), or *Any sum*. Exact matches of the number itself always show first.
   - **Rounding:** *Whole dollars* (±0.50 — returns round to dollars, so 3,234.56 matches 3,235), *Within 1 cent*, or *Exact*.
   - **Also try negatives:** any number may count as negative.

   Searches run side by side; each shows its progress and can be stopped.

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

`npm run build` writes the single self-contained file to `dist/numberfinder.html`. `npm run e2e` runs the browser tests against that built file in Microsoft Edge and saves screenshots to `test-results/shots/`. `node scripts/make-fixtures.mjs` regenerates the fake tax documents in `fixtures/` used by the tests.

| Path | What |
| --- | --- |
| `src/types.ts` | Contracts shared by extraction, the engine, and the UI |
| `src/extract/` | Reads PDFs (pdf.js), Excel and CSV (SheetJS): amounts, labels, locations |
| `src/engine/` | The search: exact lookups, combinations, negatives, per-file limits, nearest number; runs in background workers |
| `src/state/store.ts` | App state, actions, and what's remembered between sessions |
| `src/ui/` | The interface |
| `e2e/` | Browser tests of the built file |
