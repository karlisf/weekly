import { chromium } from 'playwright-core';
const S = process.argv[2];
const URL = 'http://localhost:4174/';
const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome' });
const errs = [];
async function device(name, viewport = { width: 1300, height: 820 }) {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errs.push(`${name} console: ${m.text()}`));
  await p.goto(URL);
  await p.waitForSelector('.day');
  return { ctx, p };
}
const titles = async (p) => (await p.locator('.title, .cont-title').allTextContents()).map((s) => s.trim());
const uniq = (a) => [...new Set(a)].sort();
const waitFor = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 250)); } return false; };

const A = await device('A');
const B = await device('B', { width: 390, height: 844 });

// A starts a space
await A.p.click('.sync-btn');
await A.p.fill('#dev-name', 'Laptop');
await A.p.click('text=Start syncing');
console.log('A online:', await waitFor(async () => (await A.p.locator('.status').getAttribute('data-state')) === 'online'));
await A.p.click('text=Add a device');
const code = (await A.p.locator('output.code').textContent()).trim();
console.log('code:', code);
await A.p.screenshot({ path: `${S}/sync-invite.png` });

// B joins
await B.p.click('.sync-btn');
await B.p.fill('#dev-name', 'Phone');
await B.p.click('text=Join with a code');
await B.p.fill('#join-code', code.toLowerCase());
await B.p.click('button:has-text("Find")');
await B.p.waitForSelector('text=Use the shared tasks', { timeout: 15000 });
await B.p.screenshot({ path: `${S}/sync-join.png` });
await B.p.click('button:has-text("Join")');
console.log('A sees Phone joined:', await waitFor(async () => (await A.p.locator('.joined').count()) > 0));
await A.p.screenshot({ path: `${S}/sync-joined.png` });
await A.p.keyboard.press('Escape'); await B.p.keyboard.press('Escape');

const aT = uniq(await titles(A.p));
console.log('B has A tasks:', await waitFor(async () => JSON.stringify(uniq(await titles(B.p))) === JSON.stringify(aT)));
console.log('B task count (unique titles):', uniq(await titles(B.p)).length, 'A:', aT.length);

// live: A adds a task today
await A.p.locator('.day.today .add').click();
await A.p.keyboard.type('Added on laptop');
await A.p.keyboard.press('Enter'); await A.p.keyboard.press('Escape');
const t0 = Date.now();
console.log('live add reached B:', await waitFor(async () => (await titles(B.p)).includes('Added on laptop')), `${Date.now() - t0}ms`);

// offline: B goes offline, edits title; A moves the same task; B reconnects
await B.ctx.setOffline(true);
await B.p.evaluate(() => window.dispatchEvent(new Event('offline')));
await B.p.locator('.card:has-text("Added on laptop") .body').first().click();
await B.p.fill('#task-title', 'Renamed on phone (offline)');
await B.p.keyboard.press('Enter');
await B.p.keyboard.press('Escape');
await A.p.locator('.card:has-text("Added on laptop") .body').first().click();
await A.p.click('text=Tomorrow');
await A.p.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 1500));
console.log('B sync label while offline:', (await B.p.locator('.sync-btn').getAttribute('aria-label')));
await B.ctx.setOffline(false);
await B.p.evaluate(() => window.dispatchEvent(new Event('online')));
const tomorrowCol = async (p) => p.locator('.day.today + .day .title').allTextContents();
const ok = await waitFor(async () => (await tomorrowCol(A.p)).includes('Renamed on phone (offline)') && (await tomorrowCol(B.p)).includes('Renamed on phone (offline)'), 20000);
console.log('converged after offline edits (title from B, date from A) on both:', ok);

// delete on A reaches B
await A.p.locator('.card:has-text("Something for whenever") .body').first().click();
await A.p.click('button:has-text("Delete")');
console.log('delete reached B:', await waitFor(async () => !(await titles(B.p)).includes('Something for whenever')));

// reload B: data persists and stays in sync
await B.p.reload(); await B.p.waitForSelector('.day');
console.log('B after reload equals A:', await waitFor(async () => JSON.stringify(uniq(await titles(B.p))) === JSON.stringify(uniq(await titles(A.p)))));
await B.p.click('.sync-btn'); await B.p.waitForTimeout(800);
console.log('B relays:', await B.p.locator('.meta-links .link').first().textContent());
console.log('B devices:', await B.p.locator('.devices .dname').allTextContents());
await B.p.screenshot({ path: `${S}/sync-status-mobile.png` });
console.log('errors:', JSON.stringify(errs.slice(0,6), null, 1));
await browser.close();
