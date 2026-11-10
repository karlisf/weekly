import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure';
import WebSocket from 'ws';
useWebSocketImplementation(WebSocket);
const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band', 'wss://nostr.mom', 'wss://relay.snort.social', 'wss://offchain.pub', 'wss://nostr.wine'];
const pool = new SimplePool();
const sk = generateSecretKey();
const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2,'0')).join('');
const w = rnd(), d = rnd();
const now = Math.floor(Date.now()/1000);
const ev = finalizeEvent({ kind: 30078, created_at: now, tags: [['d', d], ['w', w], ['expiration', String(now + 600)]], content: Buffer.from(crypto.getRandomValues(new Uint8Array(64))).toString('base64') }, sk);
for (const r of relays) {
  let pub, byW, byD;
  try { await Promise.race([pool.publish([r], ev)[0], new Promise((_, j) => setTimeout(() => j(new Error('timeout')), 6000))]); pub = 'ok'; } catch (e) { pub = String(e.message || e).slice(0, 70); }
  if (pub === 'ok') {
    await new Promise(r => setTimeout(r, 500));
    byW = (await pool.querySync([r], { kinds: [30078], '#w': [w] }, { maxWait: 5000 })).length;
    byD = (await pool.querySync([r], { kinds: [30078], '#d': [d] }, { maxWait: 5000 })).length;
  }
  console.log(r.padEnd(28), 'publish:', pub, pub === 'ok' ? `| #w: ${byW} | #d: ${byD}` : '');
}
pool.destroy(); process.exit(0);
