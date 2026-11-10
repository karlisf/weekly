#!/usr/bin/env node
/*
 * Minimal in-memory Nostr relay for development and tests (NIP-01, replaceable
 * events per NIP-33, expiration per NIP-40). Not for production.
 *
 *   node scripts/dev-relay.mjs [port]        # default 7777
 *   VITE_DEFAULT_RELAYS=ws://localhost:7777 npm run dev
 */
import { WebSocketServer } from 'ws';
import { verifyEvent } from 'nostr-tools/pure';
import { matchFilter } from 'nostr-tools/filter';

const port = Number(process.argv[2] ?? process.env.PORT ?? 7777);
const events = new Map(); // id -> event
const subs = new Map(); // ws -> Map<subId, filters[]>

const isReplaceable = (k) => k === 0 || k === 3 || (k >= 10000 && k < 20000) || (k >= 30000 && k < 40000);
const dTag = (e) => e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
const key = (e) => (e.kind >= 30000 && e.kind < 40000 ? `${e.kind}:${e.pubkey}:${dTag(e)}` : `${e.kind}:${e.pubkey}`);
const expired = (e) => {
  const x = e.tags.find((t) => t[0] === 'expiration')?.[1];
  return x != null && Number(x) <= Date.now() / 1000;
};

function store(e) {
  if (isReplaceable(e.kind)) {
    for (const [id, old] of events) {
      if (isReplaceable(old.kind) && key(old) === key(e)) {
        if (old.created_at > e.created_at || (old.created_at === e.created_at && old.id < e.id)) return false;
        events.delete(id);
      }
    }
  }
  events.set(e.id, e);
  return true;
}

const wss = new WebSocketServer({ port });
wss.on('connection', (ws) => {
  subs.set(ws, new Map());
  ws.on('close', () => subs.delete(ws));
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return ws.send(JSON.stringify(['NOTICE', 'invalid json']));
    }
    const [type, ...rest] = msg;
    if (type === 'EVENT') {
      const e = rest[0];
      if (!verifyEvent(e)) return ws.send(JSON.stringify(['OK', e?.id, false, 'invalid: bad signature']));
      if (expired(e)) return ws.send(JSON.stringify(['OK', e.id, false, 'invalid: expired']));
      const kept = store(e);
      ws.send(JSON.stringify(['OK', e.id, true, kept ? '' : 'duplicate: older than stored']));
      if (kept)
        for (const [client, m] of subs)
          for (const [sid, filters] of m)
            if (filters.some((f) => matchFilter(f, e))) client.send(JSON.stringify(['EVENT', sid, e]));
    } else if (type === 'REQ') {
      const [sid, ...filters] = rest;
      subs.get(ws).set(sid, filters);
      const out = [...events.values()]
        .filter((e) => !expired(e) && filters.some((f) => matchFilter(f, e)))
        .sort((a, b) => b.created_at - a.created_at);
      for (const e of out) ws.send(JSON.stringify(['EVENT', sid, e]));
      ws.send(JSON.stringify(['EOSE', sid]));
    } else if (type === 'CLOSE') {
      subs.get(ws).delete(rest[0]);
    }
  });
});
console.log(`dev relay listening on ws://localhost:${port}`);
