# Multi-device sync: design notes

Status: **planned, not implemented.** This records the decisions the current code already makes for sync, and the intended design.

## Already in place

| Decision | Why it matters for sync |
|---|---|
| Primary keys are random UUIDs created on the device | Two devices can create tasks offline without id collisions. |
| Every row has `updated_at` (ms) | Basis for last-writer-wins merging. |
| Deletes are soft (`deleted_at` tombstone) | A delete can be replicated; a hard delete would be resurrected by the other device. |
| `sort_order` is fractional | A move changes one row, not every sibling, so concurrent reorders rarely conflict. |
| Dates are calendar days (`YYYY-MM-DD`), not instants | A task on "Tuesday" stays on Tuesday across time zones. |
| `settings.deviceId` | Identifies the device, e.g. for tie-breaking equal timestamps. |
| Index on `tasks.updated_at` | "Rows changed since X" is cheap. |
| JSON import already merges by `updated_at` | The same merge rule a live sync will use. |

## Intended design

1. **Space and pairing.** The first device creates a *space*: a random room id plus a secret key. Other devices join by scanning a QR code or opening a link that carries both (in the URL fragment, which is never sent to a server). The space id, secret, and chosen signaling settings are stored in `settings`.
2. **Transport.** WebRTC data channels directly between devices. Only the connection handshake goes through a public signaling service. Candidates: [Trystero](https://github.com/dmotz/trystero), which can signal over public Nostr relays, BitTorrent trackers or MQTT brokers, so no server of our own is needed. Payloads are end-to-end encrypted with the space secret, so relays see only opaque handshakes. A public STUN server is enough for most networks. Some NATs also need a TURN relay; that is the one piece that may need a hosted service.
3. **Replication.** On connect, peers exchange "everything changed since your last sync" (`updated_at > cursor`). Rows merge per row by last writer wins, tie-broken by `deviceId`. Before relying on device clocks, `updated_at` should become a hybrid logical clock (HLC), so a device with a wrong clock can't win every conflict.
4. **Field-level merges (optional, later).** If editing the same task on two devices becomes common, track per-field clocks or move to a CRDT (Yjs/Automerge, or cr-sqlite for SQLite) so a title edit and a date change on different devices both survive.
5. **Both devices offline.** Sync is opportunistic: devices only exchange data while both are online. A small always-on relay peer would remove that limit, at the cost of hosting it.

## Schema changes this will need

- `tasks.hlc TEXT` (or replace `updated_at`) and `tasks.updated_by TEXT` (device id).
- `peers` table: device id, name, last-sync cursor.
- `space` settings: room id, encrypted secret, signaling choice.

Add these with `npm run db:generate` like any other migration.
