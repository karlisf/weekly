# Browser test scripts (unpolished)

Playwright scripts used during development to check the app in headless Chromium. They are kept here as-is so they aren't lost; turning them into a proper test suite that runs in CI is item 1 in [TODO.md](../TODO.md).

## Running

They need `playwright-core` and a Chromium build:

```sh
npm i -D playwright-core
npx playwright install chromium
```

The scripts expect Chromium at `~/.cache/ms-playwright/chromium-<build>/chrome-linux64/chrome`; adjust `executablePath` to your installed build. Most take an output folder for screenshots as their first argument, e.g. `node e2e/test.mjs /tmp/shots`.

Most scripts expect servers that you start first:

| Script | What it checks | Needs |
|---|---|---|
| `test.mjs` | Desktop and phone layouts, add task, mouse drag, reload persistence, second-tab lock | `npm run preview` (port 4173) |
| `test2.mjs` | Touch long-press drag onto the week strip | preview on 4174 |
| `focus.mjs` | Clicking a day widens its column | preview on 4174 |
| `sync.mjs` | Two devices: pairing, live updates, offline edits, deletes, reload | dev relay + test build on 4174 (below) |
| `reltest.mjs` | The in-app relay test | dev relay + test build on 4174 |
| `wake.mjs` | Resync after a simulated phone sleep | dev relay + test build on 4174 |
| `upgrade.mjs`, `loop.mjs` | Upgrading from an older build keeps data | builds of two versions (see the script) |
| `swloop.mjs`, `swfix.mjs`, `navcount.mjs` | Service worker update path (old build to new) | builds of two versions |
| `relaycheck.mjs` | Which public relays accept app events (Node, no browser) | network access |

Test build that uses the local relay:

```sh
npm run relay &                                              # ws://localhost:7777
VITE_DEFAULT_RELAYS=ws://localhost:7777 npx vite build --outDir /tmp/dist-test
npx vite preview --outDir /tmp/dist-test --port 4174 --strictPort &
```
