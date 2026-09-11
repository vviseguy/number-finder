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
  await expect(page.locator('.files-workspace .side-pane .pdf-page')).toBeVisible();
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
  await expect(page.locator('.notice')).toContainText('already in the list');
  await page.locator('.search-row', { hasText: '85,000' }).locator('.search-main').click();
  await expect(page.locator('#find-input')).toHaveValue('85,000');
  await expect(page.locator('.result-row').first()).toContainText('W-2.pdf');
});

test('sums show as an equation that opens into the full breakdown, with −( ) for negatives', async ({ page }) => {
  await open(page, ['workpapers.xlsx']);
  await page.getByLabel('Match').selectOption('2');
  await page.getByLabel('Negatives').selectOption('on');
  await page.getByLabel('Rounding').selectOption('exact');
  await find(page, '3,234.56');
  const combo = page.locator('.combo').first();
  const head = combo.locator('.combo-head');
  await expect(head).toContainText('Made of 2');
  await expect(head).toContainText('3,500.00');
  await expect(head).toContainText('= 3,234.56');
  await expect(head.locator('.neg')).toHaveCount(2); // "−(" and ")"
  await expect(combo.locator('.result-row')).toHaveCount(0); // concise until opened
  await head.click();
  await expect(combo.locator('.result-row')).toHaveCount(2);
  await expect(combo.locator('.result-row.nested .flipped')).toContainText('265.44');
  await expect(combo).toContainText('counted as negative');
  await page.screenshot({ path: path.join(SHOTS, '04-sums.png') });
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

test('a search can be edited, and its past versions viewed and restored', async ({ page }) => {
  await open(page, SOURCES);
  await find(page, '3,235');
  await expect(page.locator('.search-row')).toHaveCount(1);
  await expect(page.locator('.result-row').first()).toContainText('1099-INT.pdf');

  await page.getByRole('button', { name: 'Edit search' }).click();
  await expect(page.locator('#find-input')).toHaveValue('3,235');
  await expect(page.locator('.editing-banner')).toContainText('keeps version 1');
  await find(page, '85,000');
  await expect(page.locator('.search-row')).toHaveCount(1);
  await expect(page.locator('.search-row .target')).toContainText('85,000');
  await expect(page.locator('.result-row').first()).toContainText('W-2.pdf');

  const version = page.getByLabel('Version');
  await expect(version).toHaveValue('current');
  await version.selectOption('0');
  await expect(page.locator('.version-banner')).toContainText('Viewing version 1 of 2');
  await expect(page.locator('.result-row').first()).toContainText('1099-INT.pdf');
  await page.screenshot({ path: path.join(SHOTS, '05-versions.png') });
  await page.getByRole('button', { name: 'Back to current' }).click();
  await expect(page.locator('.version-banner')).toHaveCount(0);
  await expect(page.locator('.result-row').first()).toContainText('W-2.pdf');

  await version.selectOption('0');
  await page.getByRole('button', { name: 'Restore this version' }).click();
  await expect(page.locator('.search-row .target')).toContainText('3,235');
  await expect(version.locator('option[value="current"]')).toHaveText('v3 (current)');
  await expect(page.locator('.version-banner')).toHaveCount(0);
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

test('check every number in a group against another, from the same bar', async ({ page }) => {
  await open(page, [...SOURCES, ...RETURN]);
  await makeGroup(page, 'Source docs', SOURCES);
  await makeGroup(page, '2025 return', RETURN);
  await page.getByLabel('What to find').selectOption({ label: 'every number in 2025 return' });
  await expect(page.locator('.searchbar .where .sentence')).toHaveText('against');
  await page.getByLabel('Group to search').selectOption({ label: 'Source docs' });
  await page.getByLabel('Match').selectOption('3');
  await page.getByRole('button', { name: 'Check', exact: true }).click();

  await expect(tab(page, 'Find')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.progress-card')).toContainText('Checked', { timeout: 60_000 });
  await expect(page.locator('.search-row').first()).toContainText('Every number in');
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
