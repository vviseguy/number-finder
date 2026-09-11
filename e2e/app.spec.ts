import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const APP = `file:///${path.resolve('dist/numberfinder.html').replace(/\\/g, '/')}`;
const FIX = path.resolve('fixtures');
const SHOTS = path.resolve('test-results/shots');
mkdirSync(SHOTS, { recursive: true });

const SOURCES = ['W-2.pdf', '1099-INT.pdf', '1099-DIV.pdf', 'workpapers.xlsx'];
const RETURN = ['1040 draft.pdf', 'Schedule B.pdf'];

const tab = (page: Page, name: string) => page.locator('.step-tab', { hasText: name });

async function open(page: Page, files: string[]) {
  await page.goto(APP);
  await page.locator('#file-input').setInputFiles(files.map(f => path.join(FIX, f)));
  for (const f of files) await expect(page.locator('.file-row', { hasText: f })).toBeVisible();
  await expect(page.getByText('Reading…')).toHaveCount(0);
}

async function find(page: Page, text: string) {
  await page.locator('#find-input').fill(text);
  await page.locator('#find-input').press('Enter');
}

async function makeGroup(page: Page, name: string, files: string[]) {
  await tab(page, 'Groups').click();
  await page.getByRole('button', { name: 'Add group' }).click();
  const nameInput = page.getByLabel('Group name');
  await nameInput.fill(name);
  await nameInput.press('Enter');
  for (const f of files) await page.getByLabel(`Add a file to ${name}`).selectOption({ label: f });
}

test('the page cannot reach the network', async ({ page }) => {
  await page.goto(APP);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'none'");
  const blocked = await page.evaluate(() => fetch('https://example.com/').then(() => false, () => true));
  expect(blocked).toBe(true);
  await page.screenshot({ path: path.join(SHOTS, '01-first-run.png') });
});

test('the three steps are the navigation, and the theme can be pinned', async ({ page }) => {
  await open(page, ['W-2.pdf']);
  await expect(tab(page, 'Files')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.files-table .file-row')).toHaveCount(1);
  await page.locator('.file-row').first().click();
  await expect(page.locator('.side-pane .pdf-page')).toBeVisible();
  await tab(page, 'Groups').click();
  await expect(page.getByRole('button', { name: 'Add group' })).toBeVisible();
  await tab(page, 'Find').click();
  await expect(page.locator('.main-empty')).toBeVisible();
  await find(page, '85,000');
  await expect(tab(page, 'Find')).toHaveAttribute('aria-current', 'page');

  const theme = () => page.evaluate(() => document.documentElement.dataset.theme ?? 'system');
  expect(await theme()).toBe('system');
  await page.locator('.theme-toggle').click();
  expect(await theme()).toBe('light');
  await page.locator('.theme-toggle').click();
  expect(await theme()).toBe('dark');
  await page.screenshot({ path: path.join(SHOTS, '02-dark-pinned.png') });
  await page.reload();
  expect(await theme()).toBe('dark');
  await page.locator('.theme-toggle').click();
  expect(await theme()).toBe('system');
});

test('a file can be given a short name that is used everywhere and remembered', async ({ page }) => {
  await open(page, ['W-2.pdf']);
  await page.getByRole('button', { name: 'Rename W-2.pdf' }).click();
  const input = page.getByLabel('Short name for W-2.pdf');
  await input.fill('W2');
  await input.press('Enter');
  await expect(page.locator('.file-row').first()).toContainText('W2');
  await expect(page.locator('.file-row').first()).toContainText('W-2.pdf');
  await find(page, '85,000');
  await expect(page.locator('.result-row').first()).toContainText('W2 · page 1');
  await page.reload();
  await page.locator('#file-input').setInputFiles([path.join(FIX, 'W-2.pdf')]);
  await expect(page.locator('.file-row').first()).toContainText('W2');
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

test('the bar grammar: a range, sums:, ±, neg, and in:', async ({ page }) => {
  await open(page, SOURCES);
  await find(page, '3,200..3,300');
  await expect(page.locator('.search-row .target').first()).toContainText('3,200..3,300');
  await expect(page.locator('.result-row').first()).toContainText('3,234.56');
  await expect(page.locator('.version-bar')).toContainText('Version 1');

  await find(page, '3,234.56 sums:2 neg ±0');
  await expect(page.locator('.search-row').first()).toContainText('sums of up to 2 · exact · negatives');
  await expect(page.locator('.combo').first()).toContainText('= 3,234.56');

  await makeGroup(page, 'Source docs', ['1099-INT.pdf']);
  await find(page, '85,000 in:Source');
  await expect(page.locator('.search-row').first()).toContainText('in Source docs');
  await expect(page.locator('.not-found')).toBeVisible();
  await find(page, '85,000 in:Nowhere');
  await expect(page.locator('.notice')).toContainText('No group is called "Nowhere"');
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
  await page.getByLabel('Match').selectOption('sums');
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

test('the search area keeps its state between pages; an empty bar shows the history or a prompt', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /^data:image\/svg\+xml/); // the tab icon is the title's icon
  await tab(page, 'Find').click();
  const prompt = page.locator('.find-main > .prompt');
  await expect(prompt.locator('.add-files-prompt')).toBeVisible();
  await expect(prompt).toHaveCSS('justify-content', 'center'); // prompts sit in the middle of the column
  await page.locator('#file-input').setInputFiles([path.join(FIX, 'W-2.pdf')]);
  await tab(page, 'Files').click(); // the file list (and its "Reading…" state) lives on the Files view
  await expect(page.locator('.file-row', { hasText: 'W-2.pdf' })).toBeVisible();
  await expect(page.getByText('Reading…')).toHaveCount(0);
  await tab(page, 'Find').click();
  await expect(page.locator('.add-files-prompt')).toHaveCount(0);
  await expect(page.locator('.main-empty')).toContainText('Type a number');
  await find(page, '85,000');
  await expect(page.locator('.results')).toBeVisible();

  // Switching pages and coming back (by the step or the title) keeps the loaded search.
  await tab(page, 'Groups').click();
  await tab(page, 'Find').click();
  await expect(page.locator('.results')).toBeVisible();
  await expect(page.locator('#find-input')).toHaveValue('85,000');
  await tab(page, 'Files').click();
  await page.locator('.brand').click();
  await expect(page.locator('.results')).toBeVisible();
  await expect(page.locator('#find-input')).toHaveValue('85,000');

  // An empty bar: the history stays, nothing is selected, and the prompt is centred under it.
  await page.locator('#find-input').fill('');
  await page.locator('#find-input').press('Enter');
  await expect(page.locator('.results')).toHaveCount(0);
  await expect(page.locator('.search-row')).toHaveCount(1);
  await expect(page.locator('.main-empty')).toContainText('Pick a search from the history');
  await expect(page.locator('.notice')).toHaveCount(0);
  const history = (await page.locator('.find-main > .searches').boundingBox())!;
  const main = (await page.locator('.find-main').boundingBox())!;
  expect(Math.abs((history.x - main.x) - (main.x + main.width - history.x - history.width))).toBeLessThan(2); // centred
  await page.locator('.search-row .search-main').first().click();
  await expect(page.locator('.results')).toBeVisible();
});

test('the option pills are one dropdown each, with the sum size inside the Match pill', async ({ page }) => {
  await open(page, ['W-2.pdf']);
  const match = page.locator('.opt', { hasText: 'Match' });
  await expect(match.locator('select')).toHaveCSS('opacity', '0');
  const pill = (await match.boundingBox())!;
  const sel = (await match.locator('select').boundingBox())!;
  expect(Math.abs(sel.width - pill.width)).toBeLessThan(3); // the select covers the whole pill, so a click anywhere opens it
  await page.getByLabel('Match').selectOption('sums');
  await expect(match.locator('.sum-size + .pick-chev')).toHaveCount(1); // …Sums of up to [3] ▾
  const negatives = page.locator('.opt', { hasText: 'Negatives' });
  expect((await negatives.boundingBox())!.width).toBeLessThan(130);
});

test('the setup can be saved to a file and loaded back, by button or by dropping it', async ({ page }) => {
  await open(page, SOURCES);
  await makeGroup(page, 'Source docs', ['W-2.pdf', '1099-INT.pdf']);
  await find(page, '85,000 -hours');
  await tab(page, 'Files').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save setup' }).click()]);
  expect(download.suggestedFilename()).toBe('Number finder setup.json');
  const saved = path.join(SHOTS, 'setup.json');
  await download.saveAs(saved);

  // A fresh start: nothing remembered.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('.search-row')).toHaveCount(0);
  await page.locator('#file-input').setInputFiles([path.join(FIX, 'W-2.pdf')]);
  await expect(page.locator('.file-row', { hasText: 'W-2.pdf' })).toBeVisible();

  // Load it back: the group and the search come back; the missing file is pointed out.
  await page.getByRole('button', { name: 'Load setup…' }).click({ trial: true });
  await page.locator('#setup-input').setInputFiles(saved);
  await expect(page.locator('.notice')).toContainText('Setup loaded from setup.json: 1 group and 1 search. 1 file still to add.');
  await expect(page.locator('.file-row.missing', { hasText: '1099-INT.pdf' })).toBeVisible();
  await tab(page, 'Find').click();
  await expect(page.locator('.search-row').first()).toContainText('85,000');
  await expect(page.locator('.search-row').first()).toContainText('skipping “hours”');
  await expect(page.locator('.search-row .status')).toContainText('Not run yet');

  // Dropped with documents, a setup file is taken as a setup, not a document.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#file-input').setInputFiles([saved, path.join(FIX, '1099-INT.pdf')]);
  await expect(page.locator('.notice')).toContainText('Setup loaded');
  await tab(page, 'Groups').click();
  await expect(page.locator('.member')).toHaveCount(2);
  await expect(page.locator('.file-row', { hasText: 'setup.json' })).toHaveCount(0);
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

test('the side pane can be resized by dragging the splitter', async ({ page }) => {
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
  await tab(page, 'Find').click();
  expect(Math.abs((await pane.boundingBox())!.width - after)).toBeLessThan(4);
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

test('check: looks up every number in a group against another', async ({ page }) => {
  await open(page, [...SOURCES, ...RETURN]);
  await makeGroup(page, 'Source docs', SOURCES);
  await makeGroup(page, '2025 return', RETURN);
  // The card's button puts check:"2025 return" in the bar and picks the other group to look in.
  await page.locator('.group-card', { hasText: '2025 return' }).getByRole('button', { name: 'Check every number…' }).click();
  await expect(tab(page, 'Find')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#find-input')).toHaveValue('check:"2025 return"');
  await expect(page.locator('#find-input')).toBeFocused();
  await expect(page.locator('.searchbar .where .sentence')).toHaveText('against');
  await expect(page.locator('.searchbar .where .pick-text')).toContainText('Source docs');
  await expect(page.locator('.query-echo')).toContainText('Every number in 2025 return will be looked up against Source docs');
  await page.getByLabel('Match').selectOption('sums');
  await page.getByLabel('Most numbers in a sum').fill('3');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page.locator('.progress-card')).toContainText('Checked', { timeout: 60_000 });
  await expect(page.locator('.search-row').first()).toContainText('Every number in');
  await expect(page.locator('#find-input')).toHaveValue('check:"2025 return"'); // the query stays
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

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(SHOTS, '08-check-dark.png') });
});

test('setup is remembered, files are not', async ({ page }) => {
  await open(page, SOURCES);
  await makeGroup(page, 'Source docs', SOURCES);
  await page.reload();
  await expect(page.locator('.file-row:not(.missing)')).toHaveCount(0);
  await expect(page.locator('.file-row.missing')).toHaveCount(SOURCES.length);
  await page.locator('#file-input').setInputFiles(SOURCES.map(f => path.join(FIX, f)));
  await expect(page.locator('.file-row.missing')).toHaveCount(0);
  await tab(page, 'Groups').click();
  await expect(page.locator('.member.missing')).toHaveCount(0);
  await expect(page.locator('.member')).toHaveCount(SOURCES.length);
});
