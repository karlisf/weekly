import { chromium } from 'playwright-core';
import { execSync, spawn } from 'node:child_process';
const [S, oldDir, newDir] = process.argv.slice(2);
const serve = (dir) => spawn('npx', ['vite', 'preview', '--outDir', dir, '--port', '4177', '--strictPort'], { cwd: process.cwd(), stdio: 'ignore', detached: true });
const exe = process.env.HOME + '/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome';
execSync(`rm -rf ${S}/profile3`);
let srv = serve(oldDir); await new Promise(r => setTimeout(r, 2500));
const ctx = await chromium.launchPersistentContext(`${S}/profile3`, { executablePath: exe });
const p = await ctx.newPage();
await p.goto('http://localhost:4177/'); await p.waitForSelector('.day'); await p.waitForTimeout(3000); // SW installs
process.kill(-srv.pid); await new Promise(r => setTimeout(r, 800));
srv = serve(newDir); await new Promise(r => setTimeout(r, 2500));
const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
await p.reload(); await p.waitForSelector('.day'); await p.waitForTimeout(6000);
const toasts = await p.locator('.toast').count().catch(() => -1);
const lag = await p.evaluate(() => new Promise(r => { const t = performance.now(); setTimeout(() => r(Math.round(performance.now() - t)), 0); })).catch(() => 'page hung');
console.log('toasts:', toasts, '| timerLag:', lag, '| errors:', [...new Set(errs.map(e => e.slice(0, 120)))].slice(0, 3));
await ctx.close(); process.kill(-srv.pid);
