// Audits a website copy of Number finder: uses it (files, the file list, a short name, searches, a check, the
// theme), then asks the browser what the site stored. Everything should come back empty.
//   node scripts/audit-live.mjs [url]     (default: https://vviseguy.github.io/number-finder/)
import { chromium } from '@playwright/test';
import path from 'node:path';

const URL_ = process.argv[2] ?? 'https://vviseguy.github.io/number-finder/';
const FIX = path.resolve('fixtures');
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext();
const page = await context.newPage();
const picker = page.locator('#file-picker');

await page.goto(URL_);
await page.locator('#file-input').setInputFiles(['W-2.pdf', '1099-INT.pdf', 'workpapers.xlsx', '1040 draft.pdf'].map(f => path.join(FIX, f)));
await page.waitForFunction(() => {
  const b = document.querySelector('#file-picker');
  return b?.getAttribute('data-files') === '4' && b.getAttribute('data-reading') === '0';
}, null, { timeout: 60_000 });

await picker.click();
await page.getByRole('button', { name: 'Rename W-2.pdf' }).click();
await page.getByLabel('Short name for W-2.pdf').fill('Client Alpha W2');
await page.getByLabel('Short name for W-2.pdf').press('Enter');
await page.locator('.file-item', { hasText: 'workpapers.xlsx' }).getByRole('checkbox').uncheck();
await page.keyboard.press('Escape');
await page.locator('.theme-toggle').click();
await page.locator('#find-input').fill('3,235');
await page.locator('#find-input').press('Enter');
await page.locator('.result-row').first().waitFor({ timeout: 30_000 });
await page.locator('#find-input').fill('check:1040');
await page.locator('#find-input').press('Enter');
await page.locator('.progress-card', { hasText: 'Checked' }).waitFor({ timeout: 60_000 });
await page.locator('#find-input').fill('90,235 sums:3 draft text');

const state = await context.storageState({ indexedDB: true });
const site = state.origins.filter(o => o.origin.includes('github.io'));
console.log('cookies:', JSON.stringify(state.cookies));
console.log('site storage:', JSON.stringify(site));

await page.reload();
console.log('after reload: files =', await picker.getAttribute('data-files'), '| history rows =', await page.locator('.search-row').count(),
  '| bar =', JSON.stringify(await page.locator('#find-input').inputValue()), '| theme =', await page.evaluate(() => document.documentElement.dataset.theme ?? 'system'));
await browser.close();
