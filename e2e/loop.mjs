import { chromium } from 'playwright-core';
import { execSync, spawn } from 'node:child_process';
const S = process.argv[2];
const serve = (dir) => spawn('npx', ['vite', 'preview', '--outDir', dir, '--port', '4176', '--strictPort'], { cwd: process.cwd(), stdio: 'ignore', detached: true });
const exe = process.env.HOME + '/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome';
execSync(`rm -rf ${S}/profile2`);
const init = () => {
  window.__ws = 0; const W = window.WebSocket;
  window.WebSocket = class extends W { constructor(...a) { super(...a); window.__ws++; } };
};
let srv = serve(`${S}/dist-old`); await new Promise(r => setTimeout(r, 2500));
let ctx = await chromium.launchPersistentContext(`${S}/profile2`, { executablePath: exe, serviceWorkers: 'block' });
let p = await ctx.newPage();
await p.goto('http://localhost:4176/'); await p.waitForSelector('.day');
await p.click('.sync-btn'); await p.click('text=Start syncing'); await p.waitForTimeout(12000);
console.log('old build status:', await p.locator('.status').getAttribute('data-state'));
await ctx.close(); process.kill(-srv.pid); await new Promise(r => setTimeout(r, 1000));

srv = serve(`${S}/dist-new`); await new Promise(r => setTimeout(r, 2500));
ctx = await chromium.launchPersistentContext(`${S}/profile2`, { executablePath: exe, serviceWorkers: 'block' });
p = await ctx.newPage(); await p.addInitScript(init);
let logs = 0, errs = []; p.on('console', () => logs++); p.on('pageerror', e => errs.push(e.message));
await p.goto('http://localhost:4176/'); await p.waitForSelector('.day');
for (let i = 0; i < 4; i++) {
  await p.waitForTimeout(5000);
  const m = await p.evaluate(() => ({ ws: window.__ws, tasks: document.querySelectorAll('.card').length }));
  const lag = await p.evaluate(() => new Promise(r => { const t = performance.now(); setTimeout(() => r(Math.round(performance.now() - t)), 0); }));
  console.log(`t=${(i+1)*5}s websockets=${m.ws} console=${logs} cards=${m.tasks} timerLag=${lag}ms`);
}
await p.click('.sync-btn'); await p.waitForTimeout(500);
console.log('dialog:', (await p.locator('dialog.sync[open] .inner').textContent())?.replace(/\s+/g,' ').slice(0, 300));
console.log('pageerrors:', errs.slice(0, 5));
await ctx.close(); process.kill(-srv.pid);
