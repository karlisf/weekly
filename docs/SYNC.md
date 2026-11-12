# Sync

Weekly syncs tasks between devices, and between people who share a planner, through public Nostr relays. There is no server of our own.

## How it works

- **Local first.** Every device has the full database and works offline. Sync exchanges changes whenever a relay can be reached.
- **Merge rule: per field, newest wins.** Each task stores a hybrid logical clock (HLC) per field group: `title`, `notes`, `dates` (start and end together), `done`, `order`, `deleted`. When two copies of a task meet, each group takes the value with the higher clock. The rule gives the same result in any order and when applied twice, so devices converge.
  - Edits to different fields on two offline devices both survive.
  - When two devices edit the same field, the later edit wins and the other is lost. Conflicts are not shown to the user (deliberately simple for now).
- **Delivery: Nostr relays.** Each task is published as an encrypted, replaceable event (kind 30078, NIP-78 app data). Relays keep the latest version per device and task.
  - **Live:** devices subscribe to the space, so a change reaches open devices in about a second.
  - **Offline:** relays hold the events. A device that comes back fetches everything since its last sync (with a 24 h overlap to tolerate clock skew).
  - **Outbox:** local edits go into an `outbox` table first and are sent when a relay is reachable. Nothing is lost if the app is closed while offline.
- **Presence:** each device publishes an encrypted "device" event (name, last seen) every 5 minutes and right after it is renamed, which fills the device list. Devices are identified by their signing key, and the event is replaceable, so a new name replaces the old one everywhere.

## Spaces, keys and pairing

- A **space** is a random 32-byte key. Everyone who has it can read and change every task in that space. That's how both "my devices" and "shared with another person" work.
- From the space key, HMAC-SHA-256 derives:
  - a public **space tag** (`#w`) that relays use to route events,
  - an **AES-GCM key** for all event content,
  - per-item **d-tags**, so relays can't link events to task ids.
- Each device signs its events with its own Nostr key (stored only on that device).
- **What relays can see:** the space tag, device public keys, event times and sizes. **What they can't see:** titles, notes, dates or device names.

**Pairing by code.** On a device in the space, Sync → *Add a device* creates a 12-character code (60 bits, Crockford base32, e.g. `7K4M-Q9TX-2HBF`).

1. The code is stretched with PBKDF2 (250k iterations) into an invite tag and an AES key.
2. The space key, name and relay list are encrypted with that key and published as an event that expires after 10 minutes (NIP-40). The event is signed with a throwaway key.
3. The new device derives the same tag and key from the typed code, fetches the invite and joins.

Because of the key stretching, guessing a code from a captured invite costs 250k hashes per guess across 2^60 possible codes.

When joining, the new device either **uses the shared tasks** (its own are removed first; the default when it has only the example tasks) or **adds its tasks too**.

## Limits and next steps

- **Removing a member** isn't possible yet: anyone who joined keeps the key. Fixing it needs key rotation, i.e. a new space key sent to the remaining devices.
- **Relay retention** varies by relay. Using several relays helps. A relay that drops old events is covered as long as another relay in the list kept them.
- **History and conflict display** would need a change log with per-field parent pointers (see the discussion in git history / issue tracker).
- Every task is a separate event, so the first sync of a large planner sends one event per task, throttled to stay under relay rate limits.

## Developing

```sh
npm run relay                                       # local relay on ws://localhost:7777
VITE_DEFAULT_RELAYS=ws://localhost:7777 npm run dev # app that uses it
```

Open the app in two browser profiles (or a normal and a private window) to act as two devices.

Code: `src/sync/hlc.ts` (clock), `merge.ts` (merge rule), `crypto.ts` (keys, pairing), `engine.svelte.ts` (relays, outbox, pairing flow). Tests: `src/sync/sync.test.ts`.
