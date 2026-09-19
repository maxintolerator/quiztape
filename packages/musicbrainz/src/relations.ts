import type { Relation } from './types';

const WIKIDATA_URL = /^https?:\/\/(?:www\.)?wikidata\.org\/(?:wiki|entity)\/(Q\d+)/i;

/**
 * Extract the Wikidata item id from an entity's url-rels (inc=url-rels).
 * This is the cheapest MBID → Q-item mapping there is; only fall back to a
 * Wikidata lookup when it is absent.
 */
export function wikidataQidFromRelations(relations: readonly Relation[] | undefined): string | null {
  if (!relations) return null;
  for (const relation of relations) {
    if (relation['target-type'] !== 'url' || relation.type !== 'wikidata') continue;
    const match = relation.url?.resource.match(WIKIDATA_URL);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return null;
}
