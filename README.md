# Weekly

A week planner PWA. Tasks live in a SQLite database inside your browser; there is no server.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # planning-rule unit tests
npm run check      # Svelte + TypeScript type check
npm run build      # static site in dist/
npm run preview    # serve dist/ (service worker active)
```

## What it does

- **Week view**, Monday first. Weekdays share the width, the weekend gets narrower columns, and today is wider and highlighted. Use ← / → or the arrows to move between weeks, `T` to go back to this week. Tap the week label to pick any date and jump to it.
- **Add** a task on any day with the column's "Add task" button (or `N` for today).
- **Drag and drop** cards between days, into or out of the backlog, and up or down within a day. On touch screens, press and hold a card to pick it up.
- **Task details**: click a card to edit the title, notes, day, and an optional end day.
- **Multi-day tasks** show on every day of their span. The first day, today and Monday show a full card; the days in between show a slim line.
- **Delayed**: an open task whose last day has passed. It stays visible on its old day and is also listed under Delayed in the backlog. A setting (off by default) also carries delayed tasks over to today's column.
- **No date**: tasks without a day. They are listed in the backlog and also shown on today's column with a dashed outline (you can turn this off in Settings).
- **Sync** across devices and people via public Nostr relays, with code pairing (see below).
- Backup export/import (JSON, merged with the same rule as sync) and a raw `.sqlite3` download, in Settings.

## Layouts

| Width | Layout |
|---|---|
| ≥ 1180px | Backlog docked on the left, 7 columns |
| 720–1179px | 7 columns, backlog in a slide-over drawer |
| < 720px | Week strip on top (tap to jump, drop a card on a day to move it), days stacked vertically, backlog in a bottom sheet |

## Architecture

```
src/
  db/
    schema.ts     Drizzle ORM schema: the source of truth for the data model
    worker.ts     SQLite (official sqlite-wasm) in a Web Worker, stored in OPFS
    client.ts     Promise RPC to the worker + Drizzle "sqlite-proxy" driver
    migrate.ts    applies drizzle-kit migrations in the browser on startup
  sync/
    hlc.ts        hybrid logical clock
    merge.ts      per-field "newest wins" merge (unit-tested)
    crypto.ts     space keys, encryption, pairing codes (WebCrypto)
    engine.svelte.ts  Nostr relays: subscribe, outbox, presence, pairing
  lib/
    plan.ts       pure rules: placement, delayed, multi-day, drag → new dates (unit-tested)
    dates.ts      local calendar-day helpers ('YYYY-MM-DD', Monday weeks, ISO week no.)
    store.svelte.ts  app state (Svelte 5 runes), mutations, settings, tab lock
    dnd.svelte.ts    pointer-event drag & drop (mouse + touch long-press)
  components/     Svelte UI
drizzle/          generated SQL migrations (committed)
```

- **Svelte 5 + Vite + TypeScript.** Small runtime, no virtual DOM.
- **Storage:** `@sqlite.org/sqlite-wasm` with the `opfs-sahpool` VFS. It needs no COOP/COEP headers, so it works on GitHub Pages. If OPFS is unavailable (some private windows), the app runs in memory and warns that changes won't be kept.
- **One tab at a time:** the SAH-pool VFS allows a single connection. A Web Lock guards it; a second tab offers "Use it here", which asks the first tab (via BroadcastChannel) to close its connection.
- **ORM and migrations:** change `src/db/schema.ts`, then run `npm run db:generate`. The new SQL file in `drizzle/` is bundled and applied on next load in each browser.
- **PWA:** `vite-plugin-pwa` precaches everything including the `.wasm`, so the app works offline. A new deploy shows a "Reload" toast.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds with `BASE_PATH=/<repo>/` and publishes `dist/`. In the repo settings, set Pages → Source to "GitHub Actions".

## Sync between devices

Open **Sync** in the top bar. The first device starts a shared planner; other devices (or other people) join with a 12-character code that expires after 10 minutes. Changes are encrypted on the device and travel through public Nostr relays, live when devices are online and held by the relays when they're not. Details: [docs/SYNC.md](docs/SYNC.md).

For local development, `npm run relay` starts a small relay on `ws://localhost:7777`; run the app with `VITE_DEFAULT_RELAYS=ws://localhost:7777 npm run dev`.
