# TODO

Recommended order: 1, then 2. Everything after that builds on tested code.

## Protect what's built

- [ ] **1. End-to-end tests in the repo, run in CI**
  - The browser tests used during development (Playwright, headless Chromium) live outside the repo and will be lost.
  - They cover: drag & drop with mouse and touch, data surviving a reload, the one-tab lock, two-device sync (pairing, live updates, offline edits on both sides, deletes), waking from sleep, and upgrading from an older deployed version.
  - Move them into `e2e/`, using the local dev relay (`npm run relay`) instead of public relays.
  - Run them in GitHub Actions on every push, before the deploy step. Today CI runs only the 18 unit tests.

- [ ] **2. Test on real phones**
  - Everything so far ran in desktop Chromium, including the "phone" runs at phone screen size.
  - Untested on iPhone Safari: OPFS storage, long-press drag, installing to the home screen, sync after the phone wakes.
  - Also check Android Chrome on a real device.

- [ ] **3. Make data loss less likely**
  - Tasks live in the browser and on the relays, and relays don't promise to keep data.
  - Risk: someone clears their browser data, and the relays have pruned old events, so the tasks are gone.
  - Cheap fixes: a periodic reminder to export a backup, or an automatic encrypted snapshot published to the relays.

## Known gaps from the sync work

- [ ] **4. Removing someone from a shared planner**
  - Today anyone who joined keeps access, because they keep the space key.
  - Fix: generate a new space key and hand it to the remaining devices (key rotation).

- [ ] **5. Sync status in the backlog panel**
  - For example: "Synced 2 min ago · 2 devices".

- [ ] **6. Example tasks**
  - Stop creating them on a device that joins an existing planner, or add a "Clear all tasks" button.

- [ ] **7. Smaller first download**
  - Drop the unused 216 KB SQLite helper file (`sqlite3-worker1`) from the build and the offline cache.

## Features, since the planner can be shared

- [ ] **8. Who a task is for**
  - An owner or assignee per task, now that several people can share a planner.

- [ ] **9. Recurring tasks**
  - Daily, weekly, monthly.

- [ ] **10. Faster entry and navigation**
  - Typing "Dentist fri" puts the task on Friday.
  - Search across tasks.
  - Jump to any date.

- [ ] **11. Tags or colours**
  - To group tasks.
