import { describe, expect, it } from 'vitest';

import { deriveKey, open, randomToken, safeEqual, seal, sha256Hex } from './crypto';

describe('crypto', () => {
  const key = deriveKey('a'.repeat(40), 'lastfm-session-key');

  it('seals and opens a session key', () => {
    const sealed = seal('0123456789abcdef0123456789abcdef', key);
    expect(sealed[0]).toBe(1);
    expect(open(sealed, key)).toBe('0123456789abcdef0123456789abcdef');
  });

  it('produces a different ciphertext each time (random iv)', () => {
    expect(seal('x', key).equals(seal('x', key))).toBe(false);
  });

  it('rejects tampering and wrong keys', () => {
    const sealed = seal('secret', key);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    expect(() => open(tampered, key)).toThrow();
    expect(() => open(sealed, deriveKey('b'.repeat(40), 'lastfm-session-key'))).toThrow();
    expect(() => open(sealed, deriveKey('a'.repeat(40), 'other-purpose'))).toThrow();
  });

  it('hashes and compares tokens', () => {
    const token = randomToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(sha256Hex(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(safeEqual(sha256Hex(token), sha256Hex(token))).toBe(true);
    expect(safeEqual(sha256Hex(token), sha256Hex('nope'))).toBe(false);
  });
});
