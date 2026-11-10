import { chromium } from 'playwright-core';
const S = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome' });
const logs = [];
const d = await (await browser.newContext({ viewport: { width: 1440, height: 860 } })).newPage();
d.on('pageerror', (e) => logs.push(e.message));
await d.goto('http://localhost:4173/'); await d.waitForSelector('.day'); await d.waitForTimeout(500);
await d.screenshot({ path: `${S}/desk2.png` });
const t = await (await browser.newContext({ viewport: { width: 1024, height: 768 }, colorScheme: 'dark' })).newPage();
await t.goto('http://localhost:4173/'); await t.waitForSelector('.day'); await t.waitForTimeout(500);
await t.screenshot({ path: `${S}/tablet2.png`, clip: { x: 0, y: 0, width: 1024, height: 260 } });

const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
m.on('pageerror', (e) => logs.push(e.message));
await m.goto('http://localhost:4173/'); await m.waitForSelector('.day'); await m.waitForTimeout(900);
const cdp = await m.context().newCDPSession(m);
const card = await m.locator('.day.today .card').first().boundingBox();
const pill = await m.locator('.pill').nth(4).boundingBox(); // Friday
const pt = (x, y) => [{ x, y, id: 1 }];
const sx = card.x + 150, sy = card.y + 20;
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(sx, sy) });
await m.waitForTimeout(400);
for (let i = 1; i <= 12; i++) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(sx + (pill.x + pill.width / 2 - sx) * i / 12, sy + (pill.y + pill.height / 2 - sy) * i / 12) });
  await m.waitForTimeout(16);
}
await m.screenshot({ path: `${S}/mobile-drag.png` });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await m.waitForTimeout(300);
console.log('friday after touch drop:', await m.locator('#day-2026-11-13 .title').allTextContents());
console.log(logs.join('\n'));
await browser.close();
