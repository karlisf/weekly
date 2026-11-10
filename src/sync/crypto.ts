/*
 * Crypto for sync, built on WebCrypto only.
 *
 * A shared space is a random 32-byte key. From it we derive
 *  - a public tag that marks the space's events on relays (reveals nothing about the key),
 *  - an AES-GCM key that encrypts every event's content,
 *  - per-item "d" tags, so relays can't link items to task ids.
 *
 * A pairing code (12 Crockford base32 chars, 60 bits) is stretched with PBKDF2
 * into an invite tag and an AES key that wrap the space key for 10 minutes.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

export function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: Uint8Array, label: string): Promise<Uint8Array> {
  const k = await subtle().importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, enc.encode(label)));
}

export interface SpaceKeys {
  /** Public marker on every event of this space. */
  tag: string;
  aes: CryptoKey;
  /** Opaque, stable identifier for an item inside the space. */
  itemTag(name: string): Promise<string>;
}

export async function deriveSpace(spaceKey: Uint8Array): Promise<SpaceKeys> {
  const tag = toHex(await hmac(spaceKey, 'weekly/space-tag')).slice(0, 32);
  const aesRaw = await hmac(spaceKey, 'weekly/content-key');
  const aes = await subtle().importKey('raw', aesRaw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return {
    tag,
    aes,
    itemTag: async (name) => toHex(await hmac(spaceKey, `weekly/item/${name}`)).slice(0, 32),
  };
}

export async function seal(key: CryptoKey, data: unknown): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(JSON.stringify(data))),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64(out);
}

export async function open<T = unknown>(key: CryptoKey, sealed: string): Promise<T> {
  const raw = fromB64(sealed);
  const pt = await subtle().decrypt(
    { name: 'AES-GCM', iv: raw.slice(0, 12) as BufferSource },
    key,
    raw.slice(12) as BufferSource,
  );
  return JSON.parse(dec.decode(pt)) as T;
}

// ---------- pairing codes ----------

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
export const CODE_LENGTH = 12;

export function newPairingCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
}

/** Accepts lower case, spaces and dashes, and the usual look-alikes (O→0, I/L→1). */
export function normalizeCode(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (s.length !== CODE_LENGTH || [...s].some((c) => !ALPHABET.includes(c))) return null;
  return s;
}

export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)!.join('-');
}

export const PAIRING_ITERATIONS = 250_000;

/** Slow on purpose: guessing a code from a captured invite costs 250k hashes per guess. */
export async function derivePairing(code: string, iterations = PAIRING_ITERATIONS): Promise<{ tag: string; aes: CryptoKey }> {
  const base = await subtle().importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await subtle().deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('weekly/pairing/v1'), iterations },
      base,
      384,
    ),
  );
  const aes = await subtle().importKey('raw', bits.slice(16, 48) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { tag: toHex(bits.slice(0, 16)), aes };
}
