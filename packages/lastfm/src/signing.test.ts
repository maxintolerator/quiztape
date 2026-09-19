import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { sign } from './signing';

describe('sign', () => {
  it('sorts parameters, concatenates name+value, appends the secret and md5s it', () => {
    const params = { method: 'auth.getSession', token: 'tok', api_key: 'key' };
    const expected = createHash('md5').update('api_keykeymethodauth.getSessiontokentok' + 'secret').digest('hex');
    expect(sign(params, 'secret')).toBe(expected);
  });

  it('excludes format, callback and any prior api_sig from the signature', () => {
    const base = { method: 'auth.getSession', token: 'tok', api_key: 'key' };
    const withExtras = { ...base, format: 'json', callback: 'cb', api_sig: 'stale' };
    expect(sign(withExtras, 'secret')).toBe(sign(base, 'secret'));
  });

  it('hashes UTF-8 bytes so non-ASCII usernames sign correctly', () => {
    const expected = createHash('md5').update('api_keykmethoduser.getInfouserÜmit' + 's', 'utf8').digest('hex');
    expect(sign({ api_key: 'k', method: 'user.getInfo', user: 'Ümit' }, 's')).toBe(expected);
  });
});
