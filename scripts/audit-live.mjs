// Audits a website copy of Number finder: uses it (files, a group, searches, theme), then asks the browser
// what the site stored. Everything should come back empty.
//   node scripts/audit-live.mjs [url]     (default: https://vviseguy.github.io/number-finder/)
import { chromium } from '@playwright/test';
import path from 'node:path';

const URL_ = process.argv[2] ?? 'https://vviseguy.github.io/number-finder/';
const FIX = path.resolve('fixtures');
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(URL_);
await page.locator('#file-input').setInputFiles(['W-2.pdf', '1099-INT.pdf', 'workpapers.xlsx'].map(f => path.join(FIX, f)));
await page.getByText('Reading…').first().waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
await page.locator('.step-tab', { hasText: 'Groups' }).click();
await page.getByRole('button', { name: 'Add group' }).click();
await page.getByLabel('Group name').fill('Client Alpha');
await page.getByLabel('Group name').press('Enter');
await page.locator('.theme-toggle').click();
await page.locator('#find-input').fill('3,235');
await page.locator('#find-input').press('Enter');
await page.locator('.result-row').first().waitFor({ timeout: 30_000 });
await page.locator('#find-input').fill('90,235 sums:3');
await page.locator('#find-input').press('Enter');
await page.waitForTimeout(1500);

const state = await context.storageState({ indexedDB: true });
const site = state.origins.filter(o => o.origin.includes('github.io'));
console.log('cookies:', JSON.stringify(state.cookies));
console.log('site storage:', JSON.stringify(site));

await page.reload();
const groups = await page.locator('.step-tab', { hasText: 'Groups' }).locator('.count').textContent();
console.log('after reload: groups =', groups, '| history rows =', await page.locator('.search-row').count(), '| theme =', await page.evaluate(() => document.documentElement.dataset.theme ?? 'system'));
await browser.close();
