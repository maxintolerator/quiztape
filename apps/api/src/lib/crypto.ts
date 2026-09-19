import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/** Hex sha256 of a string; used to store tokens and codes without keeping them. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** URL-safe random token; 32 bytes = 256 bits by default. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Derive a purpose-specific 256-bit key from the server secret (HKDF-SHA256). */
export function deriveKey(secret: string, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'quiztape', purpose, 32));
}

const SEAL_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM. Layout: version(1) | iv(12) | tag(16) | ciphertext. Used for
 * Last.fm session keys at rest; the key never leaves the API process.
 */
export function seal(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([SEAL_VERSION]), iv, tag, ciphertext]);
}

export function open(sealed: Buffer, key: Buffer): string {
  if (sealed.length < 1 + IV_BYTES + TAG_BYTES) throw new Error('sealed payload too short');
  const version = sealed[0];
  if (version !== SEAL_VERSION) throw new Error(`unsupported seal version ${version}`);
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = sealed.subarray(1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Constant-time string comparison for hashes. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
