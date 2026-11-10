import { chromium } from 'playwright-core';
const S = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, colorScheme: 'light' });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:4173/');
await page.waitForSelector('.day', { timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${S}/desk-light.png` });
const storage = await page.locator('.storage').textContent();
console.log('storage:', storage.trim());

// Add a task on Thursday
const thu = page.locator('.day').nth(3);
await thu.hover();
await thu.locator('.add').click();
await page.keyboard.type('Write the sync design doc');
await page.keyboard.press('Enter');
await page.keyboard.press('Escape');
// Drag delayed task to Friday
const delayedCard = page.locator('.backlog .card').first();
const fri = page.locator('.day').nth(4);
const b = await delayedCard.boundingBox();
const f = await fri.locator('.list').boundingBox();
await page.mouse.move(b.x + 40, b.y + 10);
await page.mouse.down();
await page.mouse.move(b.x + 60, b.y + 30, { steps: 4 });
await page.mouse.move(f.x + 40, f.y + 60, { steps: 10 });
await page.waitForTimeout(100);
await page.screenshot({ path: `${S}/desk-dragging.png` });
await page.mouse.up();
await page.waitForTimeout(300);
console.log('fri tasks:', await fri.locator('.title').allTextContents());
console.log('delayed:', await page.locator('.backlog section').first().locator('.title').allTextContents());

// reload to check persistence
await page.reload();
await page.waitForSelector('.day');
await page.waitForTimeout(400);
console.log('after reload thu:', await page.locator('.day').nth(3).locator('.title').allTextContents());
console.log('after reload fri:', await page.locator('.day').nth(4).locator('.title').allTextContents());

// open details
await page.locator('.day.today .card .body').first().click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${S}/desk-dialog.png` });
await page.keyboard.press('Escape');

// second tab
const p2 = await ctx.newPage();
await p2.goto('http://localhost:4173/');
await p2.waitForTimeout(1500);
console.log('tab2 state:', (await p2.locator('.state').textContent())?.trim().replace(/\s+/g, ' '));
await p2.close();

// dark + tablet
const ctx2 = await browser.newContext({ viewport: { width: 1024, height: 768 }, colorScheme: 'dark' });
const t = await ctx2.newPage();
t.on('pageerror', (e) => logs.push(`[pageerror2] ${e.message}`));
await t.goto('http://localhost:4173/');
await t.waitForSelector('.day');
await t.waitForTimeout(500);
await t.screenshot({ path: `${S}/tablet-dark.png` });

// mobile
const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' });
const m = await ctx3.newPage();
m.on('pageerror', (e) => logs.push(`[pageerror3] ${e.message}`));
await m.goto('http://localhost:4173/');
await m.waitForSelector('.day');
await m.waitForTimeout(900);
await m.screenshot({ path: `${S}/mobile.png` });
await m.locator('.fab').tap();
await m.waitForTimeout(300);
await m.screenshot({ path: `${S}/mobile-backlog.png` });
console.log('bodyScrollW', await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
console.log(logs.join('\n'));
await browser.close();
