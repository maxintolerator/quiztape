import type { Artist, Medium, Relation, Release, ReleaseGroup, Track } from '@quiztape/musicbrainz';
import { ARTIST_RELATION_TYPE_ID } from '@quiztape/musicbrainz';

import { normalizeText } from './engine/normalize';
import { jsonResponse } from './testing';

/**
 * Scripted MusicBrainz WS/2 for tests: artist search and lookup with
 * relationships, release-group and release browsing, release lookup with
 * tracklists. Data is generated from a compact registry so tests stay readable.
 */
export interface FakeArtistSpec {
  name: string;
  type: 'Group' | 'Person';
  country?: string;
  /** Album title -> first release date; each gets one official CD release with 5 tracks and a Deluxe reissue. */
  albums?: Record<string, string>;
  /** For groups: member names, optionally with instruments and dates. */
  members?: { name: string; instruments?: string[]; begin?: string; end?: string; original?: boolean }[];
  aliases?: string[];
  /** Extra release groups that must be filtered out (compilations, live). */
  compilations?: string[];
}

let counter = 0;
const ids = new Map<string, string>();
export function idFor(key: string): string {
  let id = ids.get(key);
  if (!id) {
    counter++;
    id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
    ids.set(key, id);
  }
  return id;
}

export function createFakeMusicBrainz(specs: FakeArtistSpec[]) {
  const byId = new Map<string, FakeArtistSpec>();
  const byName = new Map<string, FakeArtistSpec>();
  for (const spec of specs) {
    byId.set(idFor(`artist:${spec.name}`), spec);
    byName.set(normalizeText(spec.name), spec);
  }
  // Persons referenced as members but not declared get a minimal Person entry.
  for (const spec of specs) {
    for (const member of spec.members ?? []) {
      if (!byName.has(normalizeText(member.name))) {
        const person: FakeArtistSpec = { name: member.name, type: 'Person' };
        byId.set(idFor(`artist:${member.name}`), person);
        byName.set(normalizeText(member.name), person);
      }
    }
  }
  const calls: URL[] = [];

  const artistJson = (spec: FakeArtistSpec, withRels: boolean): Artist => ({
    id: idFor(`artist:${spec.name}`),
    name: spec.name,
    'sort-name': spec.name,
    type: spec.type,
    country: spec.country ?? null,
    disambiguation: '',
    'life-span': { begin: '1990', end: null, ended: false },
    aliases: (spec.aliases ?? []).map((name) => ({ name, 'sort-name': name, type: 'Artist name', primary: null, locale: null, begin: null, end: null, ended: false })),
    tags: [],
    relations: withRels ? relationsFor(spec) : [],
  });

  function relationsFor(spec: FakeArtistSpec): Relation[] {
    const relations: Relation[] = [];
    const rel = (type: 'member of band', direction: 'forward' | 'backward', target: FakeArtistSpec, m: { instruments?: string[]; begin?: string; end?: string; original?: boolean }): Relation[] =>
      (m.instruments?.length ? m.instruments : ['']).map((instrument) => ({
        type,
        'type-id': ARTIST_RELATION_TYPE_ID.MEMBER_OF_BAND,
        direction,
        'target-type': 'artist',
        begin: m.begin ?? null,
        end: m.end ?? null,
        ended: !!m.end,
        attributes: [...(m.original ? ['original'] : []), ...(instrument ? [instrument] : [])],
        artist: artistJson(target, false),
      }));
    if (spec.type === 'Group') {
      for (const member of spec.members ?? []) relations.push(...rel('member of band', 'backward', byName.get(normalizeText(member.name))!, member));
    } else {
      for (const group of specs) {
        for (const member of group.members ?? []) {
          if (normalizeText(member.name) === normalizeText(spec.name)) relations.push(...rel('member of band', 'forward', group, member));
        }
      }
    }
    relations.push({ type: 'wikidata', 'type-id': '689870a4-a1e4-4912-b17f-7b2664215698', direction: 'forward', 'target-type': 'url', begin: null, end: null, ended: false, attributes: [], url: { id: 'u', resource: `https://www.wikidata.org/wiki/Q${counter}` } });
    return relations;
  }

  function releaseGroupsFor(spec: FakeArtistSpec): ReleaseGroup[] {
    const groups: ReleaseGroup[] = Object.entries(spec.albums ?? {}).map(([title, date]) => ({
      id: idFor(`rg:${spec.name}:${title}`),
      title,
      'primary-type': 'Album',
      'secondary-types': [],
      'first-release-date': date,
      disambiguation: '',
      'artist-credit': [{ name: spec.name, joinphrase: '', artist: artistJson(spec, false) }],
    }));
    for (const title of spec.compilations ?? []) {
      groups.push({ id: idFor(`rg:${spec.name}:${title}`), title, 'primary-type': 'Album', 'secondary-types': ['Compilation'], 'first-release-date': '2010-01-01', disambiguation: '', 'artist-credit': [{ name: spec.name, joinphrase: '', artist: artistJson(spec, false) }] });
    }
    return groups;
  }

  function releasesFor(spec: FakeArtistSpec, withTracks: boolean): Release[] {
    const releases: Release[] = [];
    for (const [title, date] of Object.entries(spec.albums ?? {})) {
      const group = releaseGroupsFor(spec).find((g) => g.title === title)!;
      const tracks = (n: number): Track[] =>
        Array.from({ length: n }, (_, i) => ({
          id: idFor(`track:${spec.name}:${title}:${i + 1}`),
          position: i + 1,
          number: String(i + 1),
          title: `${title} Song ${i + 1}`,
          length: 180_000 + i * 37_000,
          recording: { id: idFor(`rec:${spec.name}:${title}:${i + 1}`), title: `${title} Song ${i + 1}`, length: 180_000 + i * 37_000, disambiguation: '', video: false, 'first-release-date': date },
        }));
      const medium = (n: number, format: string): Medium => ({ position: 1, title: '', format, 'track-count': n, ...(withTracks ? { tracks: tracks(n) } : {}) });
      releases.push({ id: idFor(`rel:${spec.name}:${title}:cd`), title, status: 'Official', date, country: 'GB', disambiguation: '', quality: 'normal', media: [medium(5, 'CD')], 'release-group': group, 'artist-credit': group['artist-credit'] ?? [] });
      releases.push({ id: idFor(`rel:${spec.name}:${title}:deluxe`), title: `${title} (Deluxe Edition)`, status: 'Official', date: String(Number(date.slice(0, 4)) + 8), country: 'US', disambiguation: 'deluxe edition', quality: 'normal', media: [medium(5, 'CD'), medium(4, 'CD')], 'release-group': group, 'artist-credit': group['artist-credit'] ?? [] });
    }
    return releases;
  }

  const fetch = async (input: string): Promise<Response> => {
    const url = new URL(input);
    calls.push(url);
    const path = url.pathname.replace('/ws/2/', '');
    const limit = Number(url.searchParams.get('limit') ?? '25');
    const offset = Number(url.searchParams.get('offset') ?? '0');

    if (path === 'artist' && url.searchParams.has('query')) {
      const q = url.searchParams.get('query')!.replace(/^artist:"(.*)"$/, '$1').replace(/\\"/g, '"');
      const spec = byName.get(normalizeText(q));
      const artists = spec ? [{ ...artistJson(spec, false), score: 100 }] : [];
      return jsonResponse({ created: '', count: artists.length, offset: 0, artists });
    }
    const artistMatch = path.match(/^artist\/([0-9a-f-]+)$/);
    if (artistMatch) {
      const spec = byId.get(artistMatch[1]!);
      return spec ? jsonResponse(artistJson(spec, true)) : jsonResponse({ error: 'Not Found' }, 404);
    }
    if (path === 'release-group' && url.searchParams.has('artist')) {
      const spec = byId.get(url.searchParams.get('artist')!);
      const all = spec ? releaseGroupsFor(spec) : [];
      return jsonResponse({ 'release-group-count': all.length, 'release-group-offset': offset, 'release-groups': all.slice(offset, offset + limit) });
    }
    if (path === 'release' && url.searchParams.has('artist')) {
      const spec = byId.get(url.searchParams.get('artist')!);
      const all = spec ? releasesFor(spec, false) : [];
      return jsonResponse({ 'release-count': all.length, 'release-offset': offset, releases: all.slice(offset, offset + limit) });
    }
    const releaseMatch = path.match(/^release\/([0-9a-f-]+)$/);
    if (releaseMatch) {
      for (const spec of byId.values()) {
        const release = releasesFor(spec, true).find((r) => r.id === releaseMatch[1]);
        if (release) return jsonResponse(release);
      }
      return jsonResponse({ error: 'Not Found' }, 404);
    }
    return jsonResponse({ error: `unhandled ${path}` }, 400);
  };

  return { fetch, calls, idFor };
}
