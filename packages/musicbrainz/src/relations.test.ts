import { describe, expect, it } from 'vitest';

import { wikidataQidFromRelations } from './relations';
import type { Relation } from './types';

const rel = (over: Partial<Relation>): Relation => ({
  type: 'wikidata',
  'type-id': '689870a4-a1e4-4912-b17f-7b2664215698',
  direction: 'forward',
  'target-type': 'url',
  begin: null,
  end: null,
  ended: false,
  attributes: [],
  url: { id: 'u', resource: 'https://www.wikidata.org/wiki/Q1299' },
  ...over,
});

function withoutUrl(relation: Relation): Relation {
  const { url: _url, ...rest } = relation;
  return rest;
}

describe('wikidataQidFromRelations', () => {
  it('finds the Q-item in a wikidata url relation', () => {
    expect(wikidataQidFromRelations([rel({})])).toBe('Q1299');
  });
  it('ignores other url relations and artist relations', () => {
    expect(
      wikidataQidFromRelations([
        rel({ type: 'discogs', url: { id: 'u', resource: 'https://www.discogs.com/artist/1' } }),
        withoutUrl(rel({ 'target-type': 'artist', type: 'member of band' })),
      ]),
    ).toBeNull();
    expect(wikidataQidFromRelations(undefined)).toBeNull();
  });
});
