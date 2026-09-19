import { createHash } from 'node:crypto';

/**
 * Last.fm method signature: sort parameters by name (byte order), concatenate
 * `name + value` for each, append the shared secret, md5-hex the UTF-8 bytes.
 * `format` and `callback` are never part of the signature.
 */
export function sign(params: Record<string, string>, secret: string): string {
  const keys = Object.keys(params)
    .filter((key) => key !== 'format' && key !== 'callback' && key !== 'api_sig')
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const material = keys.map((key) => `${key}${params[key] ?? ''}`).join('') + secret;
  return createHash('md5').update(material, 'utf8').digest('hex');
}
