import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

const APP = `file:///${path.resolve('dist/numberfinder.html').replace(/\\/g, '/')}`;
const FIX = path.resolve('fixtures');
const SHOTS = path.resolve('test-results/shots');
mkdirSync(SHOTS, { recursive: true });

const SOURCES = ['W-2.pdf', '1099-INT.pdf', '1099-DIV.pdf', 'workpapers.xlsx'];
const RETURN = ['1040 draft.pdf', 'Schedule B.pdf'];

async function open(page: Page, files: string[]) {
  await page.goto(APP);
  await page.locator('input[type="file"]').setInputFiles(files.map(f => path.join(FIX, f)));
  for (const f of files) await expect(page.locator('.file-row', { hasText: f })).toBeVisible();
  await expect(page.getByText('Reading…')).toHaveCount(0);
}

async function find(page: Page, text: string) {
  await page.locator('#find-input').fill(text);
  await page.locator('#find-input').press('Enter');
}

async function makeGroup(page: Page, name: string, files: string[]) {
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

test('exact lookup: 3,235 on the return is the 1099-INT interest, rounded to whole dollars', async ({ page }) => {
  // Only the source documents: the return itself contains 3,235 exactly, which would (rightly) rank first.
  await open(page, SOURCES);
  await find(page, '3,235');
  const first = page.locator('.result-row').first();
  await expect(first).toContainText('1099-INT.pdf');
  await expect(first).toContainText('3,234.56');
  await expect(first).toContainText('rounds to 3,235');
  await expect(page.locator('.hotspot.hit')).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, '02-lookup.png'), fullPage: true });
});

test('sign flips: 3,234.56 is gross interest minus the early withdrawal penalty', async ({ page }) => {
  await open(page, ['workpapers.xlsx']);
  await page.getByLabel('Most numbers in a sum').first().fill('2');
  await expect(page.getByRole('radio', { name: 'Sums of up to' }).first()).toHaveAttribute('aria-checked', 'true');
  await page.getByLabel('Also try negatives').first().check();
  await page.getByLabel('Rounding').first().selectOption('exact');
  await find(page, '3,234.56');
  const combo = page.locator('.combo').first();
  await expect(combo).toContainText('Made of 2 numbers');
  await expect(combo).toContainText('3,500.00');
  await expect(combo).toContainText('−265.44');
  await expect(combo).toContainText('counted as negative');
  await page.screenshot({ path: path.join(SHOTS, '03-flips.png'), fullPage: true });
});

test('not found shows the nearest number: 9,120 withheld vs W-2 box 2 9,102.00', async ({ page }) => {
  await open(page, SOURCES);
  await page.getByLabel('Rounding').first().selectOption('exact');
  await find(page, '9,120');
  const nf = page.locator('.not-found');
  await expect(nf).toContainText('Not found');
  await expect(nf).toContainText('W-2.pdf');
  await expect(nf).toContainText('9,102.00');
  await expect(nf).toContainText('18.00 less than 9,120');
  await page.screenshot({ path: path.join(SHOTS, '04-not-found.png'), fullPage: true });
});

test('several searches run side by side', async ({ page }) => {
  await open(page, SOURCES);
  await page.getByRole('radio', { name: 'Any sum' }).first().click();
  for (const t of ['90,235', '3,235', '2,000', '85,000']) await find(page, t);
  await expect(page.locator('.search-row')).toHaveCount(4);
  await expect(page.locator('.search-row .status', { hasText: 'Running' })).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOTS, '05-searches.png'), fullPage: true });
});

test('check a group: the return against the source documents', async ({ page }) => {
  await open(page, [...SOURCES, ...RETURN]);
  await makeGroup(page, 'Source docs', SOURCES);
  await makeGroup(page, '2025 return', RETURN);
  await page.getByRole('button', { name: 'Check a group' }).click();
  await page.getByLabel('Group to check').selectOption({ label: '2025 return' });
  await page.getByLabel('Group to look in').selectOption({ label: 'Source docs' });
  await page.getByRole('button', { name: 'Start check' }).click();

  await expect(page.locator('.progress-card')).toContainText('Checked', { timeout: 60_000 });
  const rows = page.locator('.tieout tbody tr');
  await expect(rows.first()).toContainText('Not found');
  const text = (await rows.allInnerTexts()).join('\n');
  expect(text).toMatch(/Found[\s\S]*85,000/);          // wages tie to the W-2
  expect(text).toMatch(/Made of 3[\s\S]*90,235/);      // total income = wages + interest + dividends
  expect(text).toContain('Two digits swapped?');       // Schedule B 3,253 vs the 1099-INT's 3,235
  expect(text).toContain('Possible typo: 9,102.00');   // 9,120 withheld: a 3-number coincidence, but W-2 box 2 is 9,102
  expect(text).toContain('Nothing close');             // 410 tax-exempt interest has no source
  await page.screenshot({ path: path.join(SHOTS, '06-check.png'), fullPage: true });

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export to Excel' }).click()]);
  const saved = path.join(SHOTS, 'tieout.xlsx');
  await download.saveAs(saved);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(SHOTS, '07-check-dark.png'), fullPage: true });
});

test('setup is remembered, files are not', async ({ page }) => {
  await open(page, SOURCES);
  await makeGroup(page, 'Source docs', SOURCES);
  await page.reload();
  await expect(page.locator('.file-row:not(.missing)')).toHaveCount(0);
  await expect(page.locator('.file-row.missing')).toHaveCount(SOURCES.length);
  await page.locator('input[type="file"]').setInputFiles(SOURCES.map(f => path.join(FIX, f)));
  await expect(page.locator('.file-row.missing')).toHaveCount(0);
  await expect(page.locator('.member.missing')).toHaveCount(0);
});
