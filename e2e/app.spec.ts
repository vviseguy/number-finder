import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

// The built file from disk, or a live copy: NF_URL=https://vviseguy.github.io/number-finder/ npx playwright test
const APP = process.env.NF_URL ?? `file:///${path.resolve('dist/numberfinder.html').replace(/\\/g, '/')}`;
const FIX = path.resolve('fixtures');
const SHOTS = path.resolve('test-results/shots');
mkdirSync(SHOTS, { recursive: true });

// A blank page from disk. Pages opened from disk share the browser's storage, so this page can read whatever
// numberfinder.html would have left behind. (Against a website copy, NF_URL, these checks are skipped.)
const PROBE_FILE = path.resolve('test-results/probe/storage-probe.html');
mkdirSync(path.dirname(PROBE_FILE), { recursive: true });
writeFileSync(PROBE_FILE, '<!doctype html><title>storage probe</title><p>storage probe</p>');
const PROBE = `file:///${PROBE_FILE.replace(/\\/g, '/')}`;

/** Everything the browser holds for pages from disk (and this tab's session storage). */
async function browserStorage(page: Page) {
  await page.goto(PROBE);
  return page.evaluate(async () => {
    const opfs: string[] = [];
    try {
      const root = await navigator.storage.getDirectory() as unknown as { keys(): AsyncIterable<string> };
      for await (const name of root.keys()) opfs.push(name);
    } catch (e) {
      if ((e as Error).name !== 'SecurityError') opfs.push(`error: ${(e as Error).name}`); // SecurityError: not available to pages from disk, so nothing can be there
    }
    return {
      localStorage: Object.keys(localStorage),
      sessionStorage: Object.keys(sessionStorage),
      indexedDB: (await indexedDB.databases()).map(d => d.name),
      caches: 'caches' in self ? await caches.keys().catch(() => []) : [],
      opfs,
      cookie: document.cookie,
      windowName: window.name,
    };
  });
}
const NOTHING = { localStorage: [], sessionStorage: [], indexedDB: [], caches: [], opfs: [], cookie: '', windowName: '' };

const SOURCES = ['W-2.pdf', '1099-INT.pdf', '1099-DIV.pdf', 'workpapers.xlsx'];
const RETURN = ['1040 draft.pdf', 'Schedule B.pdf'];

/** The "in" button in the search bar, which opens the file list. */
const picker = (page: Page) => page.locator('#file-picker');
const fileItem = (page: Page, name: string) => page.locator('.file-item', { hasText: name });

/** Waits until the file list holds `count` files and none is still being read. */
async function filesRead(page: Page, count: number) {
  await expect(picker(page)).toHaveAttribute('data-files', String(count));
  await expect(picker(page)).toHaveAttribute('data-reading', '0');
}

async function open(page: Page, files: string[]) {
  await page.goto(APP);
  await page.locator('#file-input').setInputFiles(files.map(f => path.join(FIX, f)));
  await filesRead(page, files.length);
}

/** Opens the file list (if it isn't open) and returns it. */
async function openFileList(page: Page) {
  if ((await picker(page).getAttribute('aria-expanded')) !== 'true') await picker(page).click();
  const panel = page.locator('.file-panel');
  await expect(panel).toBeVisible();
  return panel;
}

async function find(page: Page, text: string) {
  await page.locator('#find-input').fill(text);
  await page.locator('#find-input').press('Enter');
}

test('the page cannot reach the network', async ({ page }) => {
  await page.goto(APP);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'none'");
  const blocked = await page.evaluate(() => fetch('https://example.com/').then(() => false, () => true));
  expect(blocked).toBe(true);
  await page.screenshot({ path: path.join(SHOTS, '01-first-run.png') });
});

test('there are no steps and no offline download: one screen', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('.step-tab')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /offline/i })).toHaveCount(0);
  await expect(page.getByText(/group/i)).toHaveCount(0);
  await expect(page.locator('.searchbar')).toBeVisible();
  await expect(page.locator('.add-files-prompt')).toBeVisible();
});

test('the file list shows a file on the right, and the theme can be pinned for the session', async ({ page }) => {
  await open(page, ['W-2.pdf']);
  const panel = await openFileList(page);
  await expect(panel.locator('.file-item')).toHaveCount(1);
  await expect(fileItem(page, 'W-2.pdf')).toContainText('PDF · 1 page');
  await panel.getByRole('button', { name: 'W-2.pdf', exact: true }).click();
  await expect(page.locator('.side-pane .pdf-page')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.main-empty')).toBeVisible();
  await find(page, '85,000');
  await expect(page.locator('.results')).toBeVisible();

  const theme = () => page.evaluate(() => document.documentElement.dataset.theme ?? 'system');
  expect(await theme()).toBe('system');
  await page.locator('.theme-toggle').click();
  expect(await theme()).toBe('light');
  await expect(page.locator('.topbar')).toHaveCSS('background-color', 'rgb(246, 245, 241)'); // warm paper, not pure white
  await page.locator('.theme-toggle').click();
  expect(await theme()).toBe('dark');
  await page.screenshot({ path: path.join(SHOTS, '02-dark-pinned.png') });
  await page.locator('.theme-toggle').click();
  expect(await theme()).toBe('system');
  await page.locator('.theme-toggle').click();
  await page.reload();
  expect(await theme()).toBe('system'); // not remembered
});

test('a file can be given a short name that is used everywhere, for this session only', async ({ page }) => {
  await open(page, ['W-2.pdf']);
  const panel = await openFileList(page);
  await panel.getByRole('button', { name: 'Rename W-2.pdf' }).click();
  const input = page.getByLabel('Short name for W-2.pdf');
  await input.fill('W2');
  await input.press('Enter'); // renames; doesn't start a search
  await expect(page.locator('.file-item-name')).toHaveText('W2');
  await expect(fileItem(page, 'W2')).toContainText('W-2.pdf ·');
  await expect(page.locator('.notice')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await find(page, '85,000');
  await expect(page.locator('.result-row').first()).toContainText('W2 · page 1');
  await page.reload();
  await page.locator('#file-input').setInputFiles([path.join(FIX, 'W-2.pdf')]);
  await filesRead(page, 1);
  await openFileList(page);
  await expect(page.locator('.file-item-name')).toHaveText('W-2.pdf'); // not remembered
});

test('the file list picks the files to search: all by default, then none, one, several, and all again', async ({ page }) => {
  await open(page, SOURCES);
  await expect(picker(page)).toContainText('All files');
  const panel = await openFileList(page);
  const ticks = panel.locator('.file-item input[type=checkbox]');
  await expect(ticks).toHaveCount(4);
  for (const tick of await ticks.all()) await expect(tick).toBeChecked();

  await panel.getByRole('button', { name: 'Select none' }).click();
  for (const tick of await ticks.all()) await expect(tick).not.toBeChecked();
  await expect(picker(page)).toContainText('No files');
  await page.keyboard.press('Escape');
  await find(page, '3,235');
  await expect(page.locator('.notice')).toContainText('No files are ticked');

  await openFileList(page);
  await fileItem(page, 'workpapers.xlsx').getByRole('checkbox').check();
  await expect(picker(page)).toContainText('workpapers.xlsx');
  await page.keyboard.press('Escape');
  await page.getByLabel('Rounding').selectOption('exact');
  await find(page, '3,234.56');
  await expect(page.locator('.result-row')).toHaveCount(2); // Interest!D9 and Summary!B3; the 1099-INT isn't ticked
  for (const text of await page.locator('.result-row').allInnerTexts()) expect(text).toContain('workpapers.xlsx');
  await expect(page.locator('.search-row').first()).toContainText('in workpapers.xlsx');

  await openFileList(page);
  await fileItem(page, '1099-INT.pdf').getByRole('checkbox').check();
  await expect(picker(page)).toContainText('2 of 4 files');
  await page.screenshot({ path: path.join(SHOTS, '14-file-list.png') });
  await panel.getByRole('button', { name: 'Select all' }).click();
  await expect(picker(page)).toContainText('All files');
  await page.keyboard.press('Escape');
  await find(page, '3,234.56'); // the same number, more files: a new version
  await expect(page.locator('.result-row')).toHaveCount(3);
  await expect(page.locator('.version-bar')).toContainText('Version 2');

  // "All files" includes files added later; a file ticked off by hand stays off.
  await page.locator('#file-input').setInputFiles([path.join(FIX, '1040 draft.pdf')]);
  await filesRead(page, 5);
  await expect(picker(page)).toContainText('All files');
  await openFileList(page);
  await fileItem(page, 'W-2.pdf').getByRole('checkbox').uncheck();
  await expect(picker(page)).toContainText('4 of 5 files');
  await fileItem(page, 'W-2.pdf').getByRole('button', { name: 'Remove W-2.pdf' }).click();
  await expect(panel.locator('.file-item')).toHaveCount(4);
});

test('exact lookup: 3,235 on the return is the 1099-INT interest, rounded to whole dollars', async ({ page }) => {
  // Only the source documents: the return itself contains 3,235 exactly, which would (rightly) rank first.
  await open(page, SOURCES);
  await find(page, '3,235');
  const first = page.locator('.result-row').first();
  await expect(first).toContainText('1099-INT.pdf');
  await expect(first).toContainText('3,234.56');
  await expect(first).toContainText('rounds to 3,235');
  await expect(page.locator('.side-pane .hotspot.hit')).toBeVisible();
  await expect(page.locator('#find-input')).toHaveValue('3,235'); // the query stays in the bar
  await page.screenshot({ path: path.join(SHOTS, '03-lookup.png') });
});

test('several numbers start several searches; a repeat just shows the existing one; selecting loads it', async ({ page }) => {
  await open(page, SOURCES);
  await find(page, '3,235 85,000');
  await expect(page.locator('.search-row')).toHaveCount(2);
  await expect(page.locator('.search-row .status', { hasText: 'Running' })).toHaveCount(0, { timeout: 30_000 });
  await find(page, '3,235');
  await expect(page.locator('.search-row')).toHaveCount(2);
  await expect(page.locator('.notice')).toContainText('already in the history');
  await page.locator('.search-row', { hasText: '85,000' }).locator('.search-main').click();
  await expect(page.locator('#find-input')).toHaveValue('85,000');
  await expect(page.locator('.result-row').first()).toContainText('W-2.pdf');
});

test('the bar grammar: a range, sums:, ±, neg, and in: with file names', async ({ page }) => {
  await open(page, SOURCES);
  await find(page, '3,200..3,300');
  await expect(page.locator('.search-row .target').first()).toContainText('3,200..3,300');
  await expect(page.locator('.result-row').first()).toContainText('3,234.56');
  await expect(page.locator('.version-bar')).toContainText('Version 1');

  await find(page, '3,234.56 sums:2 neg ±0');
  await expect(page.locator('.search-row').first()).toContainText('sums of up to 2, across files · exact · negatives');
  await expect(page.locator('.combo').first()).toContainText('= 3,234.56');

  await find(page, '85,000 in:1099-INT'); // a file name, without its extension
  await expect(page.locator('.search-row').first()).toContainText('in 1099-INT.pdf');
  await expect(page.locator('.not-found')).toBeVisible();
  await find(page, '85,000 in:1099'); // the start of a name: both 1099s
  await expect(page.locator('.search-row').first()).toContainText('in 1099-INT.pdf and 1099-DIV.pdf');
  await page.locator('#find-input').fill('85,000 in:Nowhere');
  await expect(page.locator('.query-echo')).toContainText('No file is called “Nowhere”');
  await page.locator('#find-input').press('Enter');
  await expect(page.locator('.notice')).toContainText('No file is called “Nowhere”');
});

test('the bar grammar: "quotes", ~close, \'text, and +- becomes ±', async ({ page }) => {
  await open(page, SOURCES);
  await page.getByLabel('Rounding').selectOption('exact');

  // Typing +- (or -+) folds into ± as you type, with the caret staying put.
  const input = page.locator('#find-input');
  await input.click();
  await input.pressSequentially('3,234.56 +-0.01');
  await expect(input).toHaveValue('3,234.56 ±0.01');
  await input.press('Enter');
  await expect(page.locator('.search-row').first()).toContainText('±0.01');

  // Quotes: exactly this phrase, in the label, sheet, or file name.
  await find(page, '3,234.56 "interest income"');
  await expect(page.locator('.query-echo')).toContainText('Only numbers that mention “interest income”');
  await expect(page.locator('.result-row')).toHaveCount(1);
  await expect(page.locator('.result-row').first()).toContainText('1099-INT.pdf');

  // ~word: a small typo is fine. The workpapers' "Interest" sheet counts too, so all three show again.
  await find(page, '3,234.56 ~intrest');
  await expect(page.locator('.result-row')).toHaveCount(3);
  await expect(page.locator('.result-row').first()).toContainText('1099-INT.pdf');
  await expect(page.locator('.search-row').first()).toContainText('close to “intrest”');
  await find(page, '3,234.56 ~intrst'); // two edits in a 6-letter word is too far: nothing is left to search
  await expect(page.locator('.notice')).toContainText('after the filters (close to “intrst”)');

  // 'text: not a filter, but those numbers come first; the results can be re-ordered.
  await find(page, "3,234.56 'workpapers");
  await expect(page.locator('.result-row')).toHaveCount(3);
  await expect(page.locator('.result-row').first()).toContainText('workpapers.xlsx');
  await expect(page.locator('.search-row').first()).toContainText('“workpapers” first');
  await page.getByLabel('Order of results').selectOption('position');
  await expect(page.locator('.result-row').first()).toContainText('1099-INT.pdf');
  await page.getByLabel('Order of results').selectOption('best');
  await expect(page.locator('.result-row').first()).toContainText('workpapers.xlsx');
  await page.screenshot({ path: path.join(SHOTS, '09-grammar.png') });
});

test('sums show as an equation that opens into the full breakdown, with −( ) for negatives', async ({ page }) => {
  await open(page, ['workpapers.xlsx']);
  await page.getByLabel('Match').selectOption('upto');
  await page.getByLabel('Most numbers in a sum').fill('2');
  await page.getByLabel('Negatives').selectOption('on');
  await page.getByLabel('Rounding').selectOption('exact');
  await find(page, '3,234.56');
  const combo = page.locator('.combo').first();
  const head = combo.locator('.combo-head');
  await expect(head.locator('.combo-title')).toHaveText('Sum of 2 amounts in workpapers.xlsx · 1 counted as negative');
  await expect(head.locator('.eq-terms')).toContainText('3,500.00');
  await expect(head.locator('.eq-total')).toHaveText('= 3,234.56');
  await expect(head.locator('.neg')).toHaveCount(2); // "−(" and ")"
  await expect(head.locator('.chev')).toBeVisible();
  await expect(combo.locator('.result-row')).toHaveCount(0); // stays closed until opened

  // Picking a number inside a closed sum marks the sum instead of opening it.
  await page.locator('.side-pane .cell-btn', { hasText: '265.44' }).first().click(); // starts a search for 265.44
  await page.locator('.search-row', { hasText: '3,234.56' }).locator('.search-main').click();
  await expect(combo.locator('.result-row')).toHaveCount(0);

  await head.click();
  await expect(combo.locator('.result-row')).toHaveCount(2);
  await expect(combo.locator('.result-row.nested .flipped')).toContainText('265.44');
  await page.screenshot({ path: path.join(SHOTS, '04-sums.png') });
});

test('an empty bar shows the history or a prompt, centred in the column', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /^data:image\/svg\+xml/); // the tab icon is the title's icon
  const prompt = page.locator('.find-main > .prompt');
  await expect(prompt.locator('.add-files-prompt')).toBeVisible();
  await expect(prompt).toHaveCSS('justify-content', 'center'); // prompts sit in the middle of the column
  await page.locator('#file-input').setInputFiles([path.join(FIX, 'W-2.pdf')]);
  await filesRead(page, 1);
  await expect(page.locator('.add-files-prompt')).toHaveCount(0);
  await expect(page.locator('.main-empty')).toContainText('Type a number');
  await find(page, '85,000');
  await expect(page.locator('.results')).toBeVisible();

  // An empty bar: the history stays, nothing is selected, and the prompt is centred under it.
  await page.locator('#find-input').fill('');
  await page.locator('#find-input').press('Enter');
  await expect(page.locator('.results')).toHaveCount(0);
  await expect(page.locator('.search-row')).toHaveCount(1);
  await expect(page.locator('.main-empty')).toContainText('Pick a search from the history');
  await expect(page.locator('.notice')).toHaveCount(0);
  const offCentre = await page.evaluate(() => { // inside the column's content box (the scrollbar gutter doesn't count)
    const m = document.querySelector('.find-main')!;
    const h = m.querySelector('.searches')!.getBoundingClientRect();
    const box = m.getBoundingClientRect();
    return Math.abs((h.left - box.left) - (box.left + m.clientWidth - h.right));
  });
  expect(offCentre).toBeLessThan(2); // centred
  await page.locator('.search-row .search-main').first().click();
  await expect(page.locator('.results')).toBeVisible();
});

test('sums of exactly N, from the bar and the pill', async ({ page }) => {
  await open(page, SOURCES);
  await find(page, '90,235 sums:=3'); // wages + interest + dividends = 90,234.56, whole dollars
  await expect(page.locator('.search-row').first()).toContainText('sums of exactly 3');
  await expect(page.locator('.combo-title').first()).toContainText('Sum of 3 amounts');
  await expect(page.locator('.result-list > .result-row')).toHaveCount(0); // no single numbers in "exactly" mode
  await find(page, '90,235 sums:=2');
  await expect(page.locator('.not-found')).toContainText('as a sum of exactly 2 numbers');
  await page.getByRole('button', { name: 'Try sums of up to 2' }).click();
  await expect(page.locator('.search-row').first()).toContainText('sums of up to 2');
  await page.getByLabel('Match').selectOption('exact');
  await expect(page.locator('.opt', { hasText: 'Match' }).locator('.sum-size')).toHaveValue('2');
  await page.getByLabel('Most numbers in a sum').fill('3');
  await find(page, '90,235');
  await expect(page.locator('.search-row').first()).toContainText('sums of exactly 3');
});

test('at most N numbers counted as negative', async ({ page }) => {
  await open(page, ['workpapers.xlsx']);
  await page.getByLabel('Rounding').selectOption('exact');
  await page.getByLabel('Match').selectOption('exact');
  await page.getByLabel('Most numbers in a sum').fill('2');
  await page.getByLabel('Negatives').selectOption('upto');
  await expect(page.locator('.opt', { hasText: 'Negatives' }).locator('.sum-size')).toHaveValue('1');
  await find(page, '3,234.56'); // 3,500.00 − 265.44
  await expect(page.locator('.search-row').first()).toContainText('sums of exactly 2, across files · exact · up to 1 negative');
  await expect(page.locator('.combo-title').first()).toContainText('1 counted as negative');
  await find(page, '3,234.56 neg:0'); // no pair without a negative
  await expect(page.locator('.not-found')).toBeVisible();
  await expect(page.locator('.search-row').first()).not.toContainText('negative');
  await find(page, '3,234.56 neg:1');
  await expect(page.locator('.combo-title').first()).toContainText('1 counted as negative');
  await page.screenshot({ path: path.join(SHOTS, '10-exactly-negatives.png') });
});

test('search mode: shown only for sums, and it decides which groupings come first', async ({ page }) => {
  await open(page, SOURCES);
  const modePill = page.locator('.opt', { hasText: 'Search mode' });
  await expect(modePill).toHaveCount(0); // "to number": no groupings to choose between
  await page.getByLabel('Match').selectOption('exact');
  await page.getByLabel('Most numbers in a sum').fill('3');
  await expect(modePill.locator('.pick-text')).toHaveText('across files');

  // How many files a sum's title names: "in X" = 1, "across A and B" = 2, "across A, B and 3 other files" = 5.
  const filesIn = (title: string) => {
    const others = /and (\d+) other files?/.exec(title);
    if (others) return 2 + Number(others[1]);
    return / across /.test(title) ? 2 : 1;
  };
  const titles = () => page.locator('.combo-title').allInnerTexts();

  await find(page, '90,235'); // wages + interest + dividends: one number from each of three files
  await expect(page.locator('.search-row').first()).toContainText('sums of exactly 3, across files');
  await expect(page.locator('.combo-title').first()).toContainText('and 1 other file');
  let t = await titles();
  expect(filesIn(t[0])).toBe(Math.max(...t.map(filesIn)));

  await page.getByLabel('Search mode').selectOption('clumped');
  await find(page, '90,235'); // same number, new mode: a new version of the same search
  await expect(page.locator('.search-row')).toHaveCount(1);
  await expect(page.locator('.search-row').first()).toContainText('sums of exactly 3, clumped');
  t = await titles();
  expect(filesIn(t[0])).toBe(Math.min(...t.map(filesIn)));

  await find(page, '90,235 mode:spread');
  await expect(page.locator('.search-row').first()).toContainText('sums of exactly 3, spread within files');
  await page.getByLabel('Match', { exact: true }).selectOption('1'); // exact: the preview's "Next match" buttons also say "match"
  await expect(modePill).toHaveCount(0);
});

test('time limit: a pill for sums, a note when a search runs out of time, and a way to search longer', async ({ page }) => {
  await open(page, [...SOURCES, ...RETURN]);
  const time = page.locator('.opt', { hasText: 'Time limit' });
  await expect(time).toHaveCount(0); // "to number" finishes at once
  await page.getByLabel('Match', { exact: true }).selectOption('any');
  await expect(time.locator('.pick-text')).toHaveText('30 s');

  await find(page, '12,345.67 ±0 neg time:1s'); // any count with negatives: far more than a second's work
  const note = page.locator('.search-note');
  await expect(note).toContainText('Stopped at the 1 s time limit', { timeout: 15_000 });
  await expect(page.locator('.search-row').first()).toContainText('1 s limit');
  await expect(time.locator('.pick-text')).toHaveText('1 s'); // a typed time shows as its own choice

  await note.getByRole('button', { name: 'Search again for 10 s' }).click();
  await expect(page.locator('.version-bar')).toContainText('Version 2');
  const running = page.locator('.search-note.running');
  await expect(running).toContainText('of 10 s');
  await running.getByRole('button', { name: 'Stop' }).click();
  await expect(note).toContainText('Stopped after');

  await page.getByLabel('Time limit').selectOption('none');
  await expect(time.locator('.pick-text')).toHaveText('none');
  await page.screenshot({ path: path.join(SHOTS, '12-time-limit.png') });
});

test('a big search is flagged before it runs, with one-click ways to narrow it', async ({ page }) => {
  await open(page, [...SOURCES, ...RETURN]);
  await page.locator('#find-input').fill('90,235');
  const note = page.locator('.size-note');
  await expect(note).toHaveCount(0); // "to number": nothing to warn about
  await page.getByLabel('Match', { exact: true }).selectOption('any');
  await page.getByLabel('Negatives').selectOption('on');
  await expect(note).toContainText('Big search');
  await expect(note).toContainText('longer than a lifetime');
  await expect(note).toContainText('by coincidence');
  await expect(note).toContainText('tick fewer files');
  await page.screenshot({ path: path.join(SHOTS, '13-size-note.png') });

  await note.getByRole('button', { name: 'Sums of up to 3' }).click();
  await expect(page.locator('.opt', { hasText: 'Match' }).locator('.pick-text')).toHaveText('to sum · up to');
  await expect(note.filter({ hasText: 'longer than a lifetime' })).toHaveCount(0); // small enough now (the note may be gone altogether)

  // A typed word that overrides a pill comes out of the bar when a button changes that setting.
  await page.locator('#find-input').fill('90,235 sums:any');
  await expect(note).toContainText('longer than a lifetime');
  await note.getByRole('button', { name: 'Sums of up to 3' }).click();
  await expect(page.locator('#find-input')).toHaveValue('90,235');
});

test('the preview names the file in large type, with where in it underneath', async ({ page }) => {
  await open(page, ['1099-INT.pdf', 'workpapers.xlsx']);
  await page.getByLabel('Rounding').selectOption('exact');
  await find(page, '3,234.56');
  const head = page.locator('.side-pane .preview-head');
  await expect(head.locator('.preview-name')).toHaveText('1099-INT.pdf');
  await expect(head.locator('.preview-where')).toContainText('Page 1');
  await expect(head.locator('.preview-name')).toHaveCSS('font-weight', '650');
  await page.locator('.result-row', { hasText: 'Interest!D9' }).click();
  await expect(head.locator('.preview-name')).toHaveText('workpapers.xlsx');
  await expect(head.locator('.preview-where')).toContainText('Sheet Interest · cell D9');
  await page.screenshot({ path: path.join(SHOTS, '11-preview-head.png') });
});

test('dragging the splitter scales the drawn page instead of redrawing it on every pixel', async ({ page }) => {
  await open(page, ['W-2.pdf']);
  await find(page, '85,000');
  await expect(page.locator('.side-pane canvas')).toBeVisible();
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const w = window as unknown as { __redraws: number };
    w.__redraws = 0;
    const mo = new MutationObserver(ms => { w.__redraws += ms.filter(m => m.attributeName === 'width').length; });
    document.querySelectorAll('.side-pane canvas').forEach(c => mo.observe(c, { attributes: true }));
  });
  const handle = (await page.locator('.splitter').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x - 220, handle.y + 200, { steps: 40 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as { __redraws: number }).__redraws)).toBeLessThanOrEqual(2);
  const canvasW = (await page.locator('.side-pane canvas').boundingBox())!.width;
  const bodyW = (await page.locator('.side-pane .preview-body').boundingBox())!.width;
  expect(bodyW - canvasW).toBeLessThan(60); // drawn again for the wider pane once the drag settled
  await expect(page.locator('.side-pane .hotspot.hit')).toBeVisible();
});

test('the option pills are one dropdown each, with the sum size inside the Match pill', async ({ page }) => {
  await open(page, ['W-2.pdf']);
  const match = page.locator('.opt', { hasText: 'Match' });
  await expect(match.locator('select')).toHaveCSS('opacity', '0');
  const pill = (await match.boundingBox())!;
  const sel = (await match.locator('select').boundingBox())!;
  expect(Math.abs(sel.width - pill.width)).toBeLessThan(3); // the select covers the whole pill, so a click anywhere opens it
  await page.getByLabel('Match').selectOption('upto');
  await expect(match.locator('.sum-size + .pick-chev')).toHaveCount(1); // Match  to sum · up to [3] ▾
  await expect(match.locator('.pick-text')).toHaveText('to sum · up to');
  await expect(match.locator('option')).toHaveText(['to number', 'to sum (Any count)', 'to sum (Up to count)', 'to sum (Specify count)']);
  const negatives = page.locator('.opt', { hasText: 'Negatives' });
  expect((await negatives.boundingBox())!.width).toBeLessThan(130);
});

test('not found shows the likely typo: 9,120 withheld vs W-2 box 2 9,102.00', async ({ page }) => {
  await open(page, SOURCES);
  await page.getByLabel('Rounding').selectOption('exact');
  await find(page, '9,120');
  const nf = page.locator('.not-found');
  await expect(nf).toContainText('Not found');
  await expect(nf).toContainText('two digits swapped');
  await expect(nf).toContainText('W-2.pdf');
  await expect(nf).toContainText('9,102.00');
  await expect(nf).toContainText('18.00 less than 9,120');
});

test('the same number again is a new version; versions can be viewed and restored', async ({ page }) => {
  await open(page, SOURCES);
  await find(page, '3,235');
  await expect(page.locator('.search-row')).toHaveCount(1);
  await expect(page.locator('.result-row').first()).toContainText('1099-INT.pdf');
  await expect(page.locator('.version-bar')).toContainText('Version 1');

  // Same number, different rounding: version 2 of the same search, not a second row.
  await page.getByLabel('Rounding').selectOption('exact');
  await find(page, '3,235');
  await expect(page.locator('.search-row')).toHaveCount(1);
  await expect(page.locator('.notice')).toContainText('Version 2 of the search for 3,235');
  await expect(page.locator('.version-bar')).toContainText('Version 2 of 2');
  await expect(page.locator('.not-found')).toBeVisible();

  // A "try …" button under the miss is a new version too.
  await page.getByRole('button', { name: 'Round to whole dollars' }).click();
  await expect(page.locator('.version-bar')).toContainText('Version 3 of 3');
  await expect(page.locator('.result-row').first()).toContainText('1099-INT.pdf');

  const version = page.locator('.version-bar').getByLabel('Version');
  await version.selectOption('1');
  await expect(page.locator('.version-bar')).toContainText('Version 2 of 3');
  await expect(page.locator('.version-bar')).toContainText('read-only');
  await expect(page.locator('.not-found')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '05-versions.png') });
  await page.getByRole('button', { name: 'Back to current' }).click();
  await expect(page.locator('.version-bar')).toContainText('Version 3 of 3');

  await version.selectOption('1');
  await page.getByRole('button', { name: 'Restore as v4' }).click();
  await expect(page.locator('.version-bar')).toContainText('Version 4 of 4');
  await expect(page.locator('.not-found')).toBeVisible();

  // A different number is a new search.
  await find(page, '85,000');
  await expect(page.locator('.search-row')).toHaveCount(2);
});

test('the side pane can be resized by dragging the splitter, for this session only', async ({ page }) => {
  await open(page, SOURCES);
  await find(page, '85,000');
  const pane = page.locator('.side-pane');
  const before = (await pane.boundingBox())!.width;
  const handle = (await page.locator('.splitter').boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x - 150, handle.y + 200, { steps: 8 });
  await page.mouse.up();
  const after = (await pane.boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 100);
  await page.reload();
  await page.locator('#file-input').setInputFiles([path.join(FIX, 'W-2.pdf')]);
  await filesRead(page, 1);
  expect(Math.abs((await pane.boundingBox())!.width - before)).toBeLessThan(4); // back to the default: not remembered
});

test('filters: -hours keeps hours out of the search', async ({ page }) => {
  await open(page, ['payroll.xlsx', 'W-2.pdf']);
  await page.getByLabel('Rounding').selectOption('exact');
  await find(page, '2,080');
  await expect(page.locator('.result-row').first()).toContainText('Hours');

  await find(page, '2,080 -hours');
  await expect(page.locator('.not-found')).toContainText('skipping “hours”');
  await expect(page.locator('#find-input')).toHaveValue('2,080 -hours');

  await find(page, '85,000 -hours');
  const rows = page.locator('.result-row');
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.allInnerTexts()) expect(text).not.toContain('Hours');
  await expect(page.locator('.search-row').first()).toContainText('skipping “hours”');
});

test('hovering a result marks the same number everywhere', async ({ page }) => {
  await open(page, SOURCES);
  await page.getByLabel('Rounding').selectOption('exact');
  await find(page, '3,234.56');
  await expect(page.locator('.result-row')).toHaveCount(3);
  await page.locator('.result-row').first().hover();
  await expect(page.locator('.result-row.hovered')).toHaveCount(1);
  await expect(page.locator('.result-row.linked')).toHaveCount(2);
  await expect(page.locator('.col-wrap > .rail .mark')).toHaveCount(3);
  await expect(page.locator('.side-pane .hotspot.linked, .side-pane .hotspot.hovered')).toHaveCount(1);
  await expect(page.locator('.col-wrap > .rail-count')).toContainText('3 here');
  await page.screenshot({ path: path.join(SHOTS, '06-hover-links.png') });
  await page.mouse.move(5, 5);
  await expect(page.locator('.result-row.linked')).toHaveCount(0);
});

test('check: looks up every number in some files against the other files', async ({ page }) => {
  await open(page, [...SOURCES, ...RETURN]);
  // The file list's check button puts check:"file" in the bar; checking a second file adds it.
  await openFileList(page);
  await page.getByRole('button', { name: 'Check every number in 1040 draft.pdf' }).click();
  await expect(page.locator('.file-panel')).toHaveCount(0);
  await expect(page.locator('#find-input')).toHaveValue('check:"1040 draft.pdf"');
  await expect(page.locator('#find-input')).toBeFocused();
  await openFileList(page);
  await expect(fileItem(page, '1040 draft.pdf')).toContainText('being checked');
  await expect(fileItem(page, '1040 draft.pdf').getByRole('checkbox')).toBeDisabled();
  await page.getByRole('button', { name: 'Check every number in Schedule B.pdf' }).click();
  await expect(page.locator('#find-input')).toHaveValue('check:"1040 draft.pdf" check:"Schedule B.pdf"');
  await expect(page.locator('.searchbar .where .sentence')).toHaveText('against');
  await expect(picker(page)).toContainText('The other files');
  await expect(page.locator('.query-echo')).toContainText('Every number in 1040 draft.pdf and Schedule B.pdf will be looked up in the other 4 files');
  await page.getByLabel('Match', { exact: true }).selectOption('upto');
  await page.getByLabel('Most numbers in a sum').fill('3');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page.locator('.progress-card')).toContainText('Checked', { timeout: 60_000 });
  await expect(page.locator('.search-row').first()).toContainText('1040 draft.pdf and Schedule B.pdf');
  await expect(page.locator('#find-input')).toHaveValue('check:"1040 draft.pdf" check:"Schedule B.pdf"'); // the query stays
  const rows = page.locator('.tieout tbody tr');
  await expect(rows.first()).toContainText('Not found');
  const text = (await rows.allInnerTexts()).join('\n');
  expect(text).toMatch(/Found[\s\S]*85,000/);          // wages tie to the W-2
  expect(text).toMatch(/Made of 3[\s\S]*90,235/);      // total income = wages + interest + dividends
  expect(text).toContain('= 90,234.56');               // shown as an equation
  expect(text).toContain('Two digits swapped?');       // Schedule B 3,253 vs the 1099-INT's 3,235
  expect(text).toContain('Possible typo: 9,102.00');   // 9,120 withheld: a 3-number coincidence, but W-2 box 2 is 9,102
  expect(text).toContain('Nothing close');             // 410 tax-exempt interest has no source
  await expect(page.locator('.side-pane .detail')).toContainText('Not found');
  await page.screenshot({ path: path.join(SHOTS, '07-check.png') });

  // Hovering a piece of evidence in the table links its other uses and marks them in the rail.
  await page.locator('.tieout .ev', { hasText: '85,000.00' }).first().hover();
  await expect(page.locator('.tieout .ev.linked, .tieout .ev.hovered')).toHaveCount(2);
  await page.mouse.move(5, 5);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export to Excel' }).click()]);
  const saved = path.join(SHOTS, 'tieout.xlsx');
  await download.saveAs(saved);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);

  // Typed by hand, with the start of a name, and with fewer files ticked to look in.
  await openFileList(page);
  await fileItem(page, 'workpapers.xlsx').getByRole('checkbox').uncheck();
  await page.keyboard.press('Escape');
  await page.locator('#find-input').fill('check:1040 check:schedule');
  await expect(page.locator('.query-echo')).toContainText('will be looked up in 3 files');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(SHOTS, '08-check-dark.png') });
});

// ---------- nothing is saved: the audit ----------

test('the browser storage APIs are turned off in the page, and in frames', async ({ page }) => {
  await page.goto(APP);
  const result = await page.evaluate(() => {
    const off = (fn: () => unknown) => {
      try { fn(); return 'allowed'; } catch (e) { return String((e as Error).message).includes('keeps everything in memory') ? 'off' : `other: ${(e as Error).message}`; }
    };
    const frame = document.createElement('iframe');
    document.body.append(frame);
    window.name = 'carried over';
    return {
      localStorage: off(() => localStorage.length),
      sessionStorage: off(() => sessionStorage.length),
      indexedDB: off(() => indexedDB.open('x')),
      caches: 'caches' in window ? off(() => caches.keys()) : 'off',
      storage: off(() => navigator.storage.getDirectory()),
      pushState: off(() => history.pushState(null, '', '#x')),
      open: off(() => window.open('about:blank')),
      cookieWrite: off(() => { document.cookie = 'a=1'; }),
      cookie: document.cookie,
      windowName: window.name,
      frameLocalStorage: off(() => frame.contentWindow!.localStorage.length),
      frameIndexedDB: off(() => frame.contentDocument!.defaultView!.indexedDB.open('y')),
    };
  });
  expect(result).toEqual({
    localStorage: 'off', sessionStorage: 'off', indexedDB: 'off', caches: 'off', storage: 'off', pushState: 'off', open: 'off',
    cookieWrite: 'off', cookie: '', windowName: '', frameLocalStorage: 'off', frameIndexedDB: 'off',
  });
});

test('after a full session, the browser holds nothing, and reloading starts from scratch', async ({ page, context }) => {
  test.skip(!!process.env.NF_URL, 'reads storage through a page from disk');
  await open(page, [...SOURCES, ...RETURN]);
  const panel = await openFileList(page);
  await panel.getByRole('button', { name: 'Rename W-2.pdf' }).click();
  // No form field lets the browser keep what was typed (checked with the file list and a short-name box open).
  const remembered = await page.locator('input, select, textarea').evaluateAll(els =>
    els.filter(e => e.getAttribute('autocomplete') !== 'off').map(e => e.outerHTML.slice(0, 80)));
  expect(remembered).toEqual([]);
  await page.getByLabel('Short name for W-2.pdf').fill('W2');
  await page.getByLabel('Short name for W-2.pdf').press('Enter');
  await fileItem(page, 'workpapers.xlsx').getByRole('checkbox').uncheck();
  await page.keyboard.press('Escape');
  await page.locator('.theme-toggle').click();
  await find(page, '3,235');
  await expect(page.locator('.result-row').first()).toBeVisible();
  await page.getByLabel('Match', { exact: true }).selectOption('upto');
  await find(page, '90,235 -hours');
  await find(page, 'check:1040 check:schedule');
  await expect(page.locator('.progress-card')).toContainText('Checked', { timeout: 60_000 });
  const handle = (await page.locator('.splitter').boundingBox())!;
  await page.mouse.move(handle.x + 4, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x - 120, handle.y + 200, { steps: 6 });
  await page.mouse.up();
  await page.locator('#find-input').fill('9,120 draft text');

  expect(await browserStorage(page)).toEqual(NOTHING);
  expect(await context.cookies()).toEqual([]);

  await page.goto(APP);
  await expect(picker(page)).toHaveAttribute('data-files', '0');
  await expect(picker(page)).toContainText('No files yet');
  await expect(page.locator('#find-input')).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.dataset.theme ?? 'system')).toBe('system');
  await expect(page.locator('.search-row')).toHaveCount(0);
  await expect(page.locator('.add-files-prompt')).toBeVisible();
});

test('what older versions saved is deleted when the page opens, and nothing else is touched', async ({ page }) => {
  test.skip(!!process.env.NF_URL, 'seeds storage through a page from disk');
  await page.goto(PROBE);
  await page.evaluate(async () => {
    localStorage.setItem('number-finder:setup:v4', JSON.stringify({ groups: [{ id: 'g', name: 'Client Alpha', color: 0, members: [] }], runs: [{ kind: 'search', target: 3235 }] }));
    localStorage.setItem('number-finder:theme', 'dark');
    localStorage.setItem('number-finder:pane', '700');
    localStorage.setItem('another-app:settings', 'kept');
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('number-finder', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
  });

  await page.goto(APP);
  await expect(picker(page)).toHaveAttribute('data-files', '0');
  await expect(page.locator('.search-row')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.theme ?? 'system')).toBe('system');
  await page.waitForTimeout(300); // the old database is deleted in the background

  const left = await browserStorage(page);
  expect(left.localStorage).toEqual(['another-app:settings']);
  expect(left.indexedDB).toEqual([]);
});
