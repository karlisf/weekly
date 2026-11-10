# What it took to build Weekly (so far)

The app was built in one Claude Code session, from an empty folder to a deployed PWA with multi-device sync. Claude wrote all code; the owner gave direction, tested in real browsers and reported problems. Times below are elapsed time since the session started.

## Totals

| | |
|---|---|
| Session length (wall clock) | **2 h 12 min** |
| Model working time (API) | **36 min 41 s** |
| Rest of the time | Builds, tests and deploys run by Claude, plus the owner's testing and replies |
| Model requests | 169 to Claude Opus 5.5, plus a few tiny Claude Haiku 5.5 background calls |
| Tokens | ≈ 37.8 M in total: 37.2 M cache reads, 350.5 k cache writes, 222.8 k output, 2.1 k uncached input |
| Prompt cache hit rate | 99 % of input tokens |
| Cost at API list prices | **$14.71** (Haiku: $0.0002) |
| Code changes reported by Claude Code | 2,369 lines added, 28 removed (Claude's own edits, not counting generated files) |

Source: Claude Code's `/cost` at the end of the session, cross-checked against the session transcript.

## The code

| | |
|---|---|
| Hand-written source | ≈ 5,700 lines in 42 files (TypeScript 2,371 · Svelte 2,798 · CSS 209 · dev relay 73 · SQL 25 · CI 44) |
| Largest files | `SyncDialog.svelte` 708 · `sync/engine.svelte.ts` 567 · `App.svelte` 475 · `lib/store.svelte.ts` 460 |
| Unit tests | 18 (week maths, planning rules, sync clock, merge rule, encryption, pairing codes) |
| Database migrations | 2 (initial schema; sync clocks + outbox) |
| Built site | 2.0 MB, about 0.5 MB gzipped on first load (the SQLite engine is 412 kB of that) |
| Stack | Svelte 5, Vite 8, TypeScript, SQLite WASM on OPFS, Drizzle ORM, nostr-tools, vite-plugin-pwa |

## Timeline

| Elapsed | Commit | What happened |
|---|---|---|
| 0:00 | | Request: SPA/PWA week planner with SQLite, drag & drop, delayed and no-date tasks, multi-day tasks, sync-ready design |
| 0:23 | `f371f3b` | First version: week grid, phone agenda, backlog, task dialog, drag & drop (mouse + touch), OPFS SQLite with Drizzle migrations, PWA, GitHub Pages workflow |
| 0:36 | `e5520b6` | Pushed to GitHub. Pages showed a blank page: its source was "Deploy from a branch" instead of "GitHub Actions" |
| 1:03 | `bfeb458` | Sync: per-field merge with hybrid logical clocks, encrypted Nostr events, code pairing, outbox for offline edits |
| 1:17 | `cdfcf8e` | **Production issue 1:** pairing failed. Most default relays were unreachable from the test network, and relay.primal.net never confirmed storing events. Added an in-app relay test and switched the defaults |
| 1:33 | `37f3dd5` | **Production issue 2:** the app froze with 1,000+ toasts. The "new version" toast was raised from an effect that re-triggered itself. Fixed, and switched the PWA to auto-update |
| 1:48 | `d719af2` | UX: clicking a day widens its column on desktop |
| 1:59 | `1adb63a` | Sync resumes immediately when the app returns to the foreground (0.2 s instead of 7.4 s in a simulated phone-sleep test) |

7 commits and 7 GitHub Actions deploys; one deploy failed because of the Pages setting.

## How it was verified

- **Unit tests** (Vitest) for the pure logic.
- **Headless Chromium scripts** (Playwright) against production builds:
  - desktop and phone layouts, light and dark themes;
  - mouse drag and touch long-press drag;
  - data surviving a reload, and the one-tab-at-a-time lock;
  - two "devices" (separate browser profiles) syncing through a local relay and through real public relays: pairing, live updates, offline edits on both sides, deletes;
  - upgrading from an older deployed version, including the service worker update path;
  - a simulated phone sleep and wake.
- **The owner**, testing the live site in a real browser. That is how both production issues were found.

These browser scripts are not in the repository yet.

## Notes on the numbers

- Most tokens are cache reads: each request re-sends the whole conversation, served from cache at 5 % of the input price. Without caching, the same session would have cost several times more.
- "Model working time" covers only the time the model spent generating. Waiting for builds, tests and deploys, and the owner's own testing, make up the rest of the session.
- The cost is at API list prices; on a subscription plan nothing is billed per token. Prices assumed for Claude Opus 5.5: $4 per million input tokens, $20 output, $0.20 cache read, $8 for 1-hour cache writes.
