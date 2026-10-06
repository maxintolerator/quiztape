import { describe, expect, it } from 'vitest';

import { randomToken, safeEqual, sha256Hex } from './crypto';

describe('crypto', () => {
  it('hashes and compares tokens', () => {
    const token = randomToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(sha256Hex(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(safeEqual(sha256Hex(token), sha256Hex(token))).toBe(true);
    expect(safeEqual(sha256Hex(token), sha256Hex('nope'))).toBe(false);
  });
});
