import { chromium } from 'playwright-core';
import { execSync, spawn } from 'node:child_process';
const [S, ...dirs] = process.argv.slice(2);
const serve = (dir) => spawn('npx', ['vite', 'preview', '--outDir', dir, '--port', '4177', '--strictPort'], { cwd: process.cwd(), stdio: 'ignore', detached: true });
const exe = process.env.HOME + '/.cache/ms-playwright/chromium-1237/chrome-linux64/chrome';
execSync(`rm -rf ${S}/profile4`);
const ctx = await chromium.launchPersistentContext(`${S}/profile4`, { executablePath: exe });
const p = await ctx.newPage();
let navs = 0; p.on('framenavigated', (f) => f === p.mainFrame() && navs++);
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 100)));
for (const dir of dirs) {
  const srv = serve(dir); await new Promise(r => setTimeout(r, 2500));
  navs = 0;
  const reqs = new Map();
  const onReq = (r) => reqs.set(r, 'pending');
  const onRes = (r) => reqs.set(r.request(), r.status() + (r.fromServiceWorker() ? ' (sw)' : ''));
  const onFail = (r) => reqs.set(r, 'FAILED ' + r.failure()?.errorText);
  p.on('request', onReq); p.on('response', onRes); p.on('requestfailed', onFail);
  globalThis.__dump = () => { for (const [r, st] of reqs) console.log('   ', st.padEnd(14), r.url().replace('http://localhost:4177', '')); };
  await p.goto('http://localhost:4177/').catch(e => console.log('goto', e.message.slice(0, 80)));
  await new Promise(r => setTimeout(r, 10000));
  const b = await Promise.race([p.evaluate(() => [...document.scripts].map(s => s.src).find(s => s.includes('index-'))?.split('/').pop() + ' toasts=' + document.querySelectorAll('.toast').length), new Promise(r => setTimeout(() => r('evaluate timed out (main thread busy)'), 5000))]);
  console.log(dir.split('/').pop(), '| navigations in 10s:', navs, '|', b);
  if (String(b).includes('busy')) {
    globalThis.__dump();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Debugger.enable');
    const paused = new Promise(r => cdp.once('Debugger.paused', r));
    await cdp.send('Debugger.pause');
    const ev = await Promise.race([paused, new Promise(r => setTimeout(() => r(null), 8000))]);
    if (ev) for (const f of ev.callFrames.slice(0, 14)) console.log('   at', f.functionName || '(anon)', f.url.split('/').pop(), f.location.lineNumber + ':' + f.location.columnNumber);
    else console.log('   could not pause');
  }
  process.kill(-srv.pid); await new Promise(r => setTimeout(r, 800));
}
console.log('errors:', [...new Set(errs)].slice(0, 4));
await ctx.close();
