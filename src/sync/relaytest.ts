/*
 * Checks, from this browser, whether a relay can carry Weekly's sync traffic:
 * it must accept a WebSocket connection, store our kind of event (also with an
 * expiration tag, which pairing invites use), and return it when queried by tag.
 * Test events are random bytes, signed with a throwaway key, and expire in a minute.
 */
import { Relay } from 'nostr-tools/relay';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { randomBytes, toB64, toHex } from './crypto';
import { KIND } from './engine.svelte';

export interface RelayTestResult {
  url: string;
  connects: boolean;
  accepts: boolean;
  acceptsExpiring: boolean;
  findable: boolean;
  note: string;
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);

const reason = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 140);

export async function testRelay(url: string): Promise<RelayTestResult> {
  const r: RelayTestResult = { url, connects: false, accepts: false, acceptsExpiring: false, findable: false, note: '' };
  let relay: Relay | null = null;
  try {
    relay = await withTimeout(Relay.connect(url), 7000, 'Connecting');
    r.connects = true;
  } catch (e) {
    r.note = `Can't connect: ${reason(e)}. A network filter, VPN or browser extension may block it.`;
    return r;
  }
  const sk = generateSecretKey();
  const tag = toHex(randomBytes(16));
  const now = Math.floor(Date.now() / 1000);
  const make = (d: string, extra: string[][]) =>
    finalizeEvent(
      { kind: KIND, created_at: now, tags: [['d', d], ['w', tag], ...extra], content: toB64(randomBytes(48)) },
      sk,
    );
  try {
    await withTimeout(relay.publish(make(toHex(randomBytes(16)), [])), 7000, 'Publishing');
    r.accepts = true;
  } catch (e) {
    r.note = `Rejects sync events: ${reason(e)}`;
  }
  try {
    await withTimeout(relay.publish(make(toHex(randomBytes(16)), [['expiration', String(now + 60)]])), 7000, 'Publishing');
    r.acceptsExpiring = true;
  } catch (e) {
    r.note ||= `Rejects pairing codes: ${reason(e)}`;
  }
  if (r.accepts || r.acceptsExpiring) {
    const found = await new Promise<number>((resolve) => {
      let n = 0;
      const sub = relay!.subscribe([{ kinds: [KIND], '#w': [tag] }], {
        onevent: () => n++,
        oneose: () => {
          sub.close();
          resolve(n);
        },
      });
      setTimeout(() => {
        sub.close();
        resolve(n);
      }, 6000);
    });
    r.findable = found > 0;
    if (!r.findable) r.note ||= 'Stores events but does not return them by tag.';
  }
  relay.close();
  if (!r.note) r.note = 'Works';
  return r;
}

export const usable = (r: RelayTestResult) => r.connects && r.accepts && r.acceptsExpiring && r.findable;
