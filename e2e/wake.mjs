import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome' });
const init = () => {
  const W = window.WebSocket; window.__socks = []; window.__block = false; window.__vis = 'visible';
  window.WebSocket = class extends W { constructor(url, ...r) { super(window.__block ? 'ws://127.0.0.1:1' : url, ...r); window.__socks.push(this); } };
  Object.defineProperty(document, 'visibilityState', { get: () => window.__vis });
};
async function dev() { const c = await b.newContext({ viewport: { width: 1300, height: 820 } }); const p = await c.newPage(); await p.addInitScript(init); await p.goto('http://localhost:4174/'); await p.waitForSelector('.day'); return p; }
const waitFor = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return Date.now() - t; await new Promise(r => setTimeout(r, 200)); } return null; };
const A = await dev(), B = await dev();
await A.click('.sync-btn'); await A.click('text=Start syncing'); await A.waitForSelector('.status[data-state="online"]');
await A.click('text=Add a device'); const code = (await A.locator('output.code').textContent()).trim();
await B.click('.sync-btn'); await B.click('text=Join with a code'); await B.fill('#join-code', code); await B.click('button:has-text("Find")');
await B.waitForSelector('text=Use the shared tasks'); await B.click('button:has-text("Join")'); await B.waitForTimeout(2000);
await A.keyboard.press('Escape'); await B.keyboard.press('Escape'); await B.waitForTimeout(6000);
const has = (p, t) => p.locator('.title').allTextContents().then(a => a.includes(t));

for (const wake of [true, false]) {
  const title = wake ? 'Added while phone slept (wake)' : 'Added while phone slept (no wake)';
  // B "sleeps": hidden, sockets dropped, reconnects fail
  await B.evaluate(() => { window.__vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); window.__block = true; for (const s of window.__socks) s.close(); });
  await B.waitForTimeout(1000);
  await A.locator('.day.today .add').click(); await A.keyboard.type(title); await A.keyboard.press('Enter'); await A.keyboard.press('Escape');
  await A.waitForTimeout(1500);
  // B wakes up: network usable again
  await B.evaluate((wake) => { window.__block = false; window.__vis = 'visible'; if (wake) document.dispatchEvent(new Event('visibilitychange')); }, wake);
  const ms = await waitFor(() => has(B, title), 15000);
  console.log(wake ? 'with foreground resync:   ' : 'without (old behaviour):  ', ms == null ? 'not arrived within 15s' : `arrived after ${ms} ms`);
  await B.waitForTimeout(6000); // let the 5s throttle pass before the next round
}
await b.close();
