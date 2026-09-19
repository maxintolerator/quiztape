import { schema } from '@quiztape/db';
import { ARTIST_RELATION_TYPE_ID } from '@quiztape/musicbrainz';
import { type Difficulty, DIFFICULTIES, MIN_PLAYS_FOR_QUESTIONS, SIDE_B_CATEGORIES, type SideBCategory, UNIT_DURATION, UNIT_YEAR } from '@quiztape/shared';
import { and, eq, gte, inArray, isNotNull, ne } from 'drizzle-orm';

import { stripEditionSuffix } from './normalize';
import { buildQuestion, optionIdFor } from './side-a';
import type { GeneratedQuestion, GeneratorContext } from './types';

/** An artist the user listens to, joined to its MusicBrainz facts. */
interface TriviaArtist {
  artistKey: string;
  artistName: string;
  rank: number;
  playCount: number;
  difficulty: Difficulty;
  mbid: string;
  mbName: string;
  type: string | null;
  country: string | null;
}

type Album = typeof schema.mbReleaseGroups.$inferSelect;
type Track = typeof schema.mbTracks.$inferSelect;
type Relation = typeof schema.mbArtistRelations.$inferSelect;

/** Categories on by default; the optional toggles (geo, producer, label) need Wikidata and are not generated yet. */
const DEFAULT_CATEGORIES = SIDE_B_CATEGORIES.filter((c) => c !== 'geo_origin' && c !== 'producer' && c !== 'label');

/**
 * Side B: a join between the user's artists and the cached MusicBrainz
 * facts. Every generator refuses ambiguous or thin data and returns null.
 */
export async function generateSideBQuestions(ctx: GeneratorContext, options: { difficulty: Difficulty; count: number }): Promise<GeneratedQuestion[]> {
  const artists = await loadTriviaArtists(ctx);
  if (artists.length === 0) return [];
  const questions: GeneratedQuestion[] = [];
  const categories = ctx.rng.shuffle(DEFAULT_CATEGORIES);
  let categoryIndex = 0;
  let attempts = 0;
  const maxAttempts = options.count * 14;
  while (questions.length < options.count && attempts < maxAttempts) {
    attempts++;
    const category = categories[categoryIndex++ % categories.length]!;
    const anchor = pickAnchor(ctx, artists, options.difficulty);
    if (!anchor) break;
    const question = await GENERATORS[category](ctx, anchor, artists);
    if (!question) continue;
    if (ctx.recentFingerprints.has(question.fingerprint)) continue;
    if (questions.some((q) => q.fingerprint === question.fingerprint)) continue;
    ctx.usedArtistKeys.add(anchor.artistKey);
    questions.push(question);
  }
  return questions;
}

async function loadTriviaArtists(ctx: GeneratorContext): Promise<TriviaArtist[]> {
  const rows = await ctx.db
    .select({
      artistKey: schema.userArtistStats.artistKey,
      artistName: schema.userArtistStats.artistName,
      rank: schema.userArtistStats.rank,
      playCount: schema.userArtistStats.playCount,
      difficulty: schema.userArtistStats.difficulty,
      mbid: schema.mbArtists.mbid,
      mbName: schema.mbArtists.name,
      type: schema.mbArtists.type,
      country: schema.mbArtists.country,
    })
    .from(schema.userArtistStats)
    .innerJoin(schema.artistResolutions, and(eq(schema.artistResolutions.artistKey, schema.userArtistStats.artistKey), eq(schema.artistResolutions.status, 'resolved')))
    .innerJoin(schema.mbArtists, and(eq(schema.mbArtists.mbid, schema.artistResolutions.mbid), isNotNull(schema.mbArtists.tracklistsFetchedAt), eq(schema.mbArtists.isSpecialPurpose, false)))
    .where(and(eq(schema.userArtistStats.userId, ctx.userId), gte(schema.userArtistStats.playCount, MIN_PLAYS_FOR_QUESTIONS)))
    .orderBy(schema.userArtistStats.rank);
  return rows;
}

function pickAnchor(ctx: GeneratorContext, artists: TriviaArtist[], difficulty: Difficulty): TriviaArtist | null {
  const available = artists.filter((a) => !ctx.usedArtistKeys.has(a.artistKey));
  if (available.length === 0) return null;
  const tierIndex = DIFFICULTIES.indexOf(difficulty);
  const roll = ctx.rng.next();
  const wanted: Difficulty[] =
    roll < 0.7 ? [difficulty] : roll < 0.85 ? [DIFFICULTIES[Math.max(0, tierIndex - 1)]!] : [DIFFICULTIES[Math.min(DIFFICULTIES.length - 1, tierIndex + 1)]!];
  const pool = available.filter((a) => wanted.includes(a.difficulty));
  return ctx.rng.pick(pool.length > 0 ? pool : available);
}

// ------------------------------------------------------------------ data access

async function studioAlbums(ctx: GeneratorContext, artistMbid: string): Promise<Album[]> {
  return ctx.db
    .select()
    .from(schema.mbReleaseGroups)
    .where(and(eq(schema.mbReleaseGroups.primaryArtistMbid, artistMbid), eq(schema.mbReleaseGroups.isStudioAlbum, true), isNotNull(schema.mbReleaseGroups.firstReleaseYear)))
    .orderBy(schema.mbReleaseGroups.firstReleaseDate, schema.mbReleaseGroups.title);
}

async function tracklist(ctx: GeneratorContext, album: Album): Promise<Track[]> {
  if (!album.canonicalReleaseMbid) return [];
  return ctx.db.select().from(schema.mbTracks).where(eq(schema.mbTracks.releaseMbid, album.canonicalReleaseMbid)).orderBy(schema.mbTracks.absolutePosition);
}

async function albumsWithTracklists(ctx: GeneratorContext, artistMbid: string): Promise<{ album: Album; tracks: Track[] }[]> {
  const albums = await studioAlbums(ctx, artistMbid);
  const out: { album: Album; tracks: Track[] }[] = [];
  for (const album of albums) {
    const tracks = await tracklist(ctx, album);
    if (tracks.length >= 3) out.push({ album, tracks });
  }
  return out;
}

/** Track keys the user has actually played for this artist, to prefer familiar songs. */
async function playedTrackKeys(ctx: GeneratorContext, artistKey: string): Promise<Set<string>> {
  const rows = await ctx.db
    .select({ trackKey: schema.userTrackStats.trackKey })
    .from(schema.userTrackStats)
    .where(and(eq(schema.userTrackStats.userId, ctx.userId), eq(schema.userTrackStats.artistKey, artistKey)));
  return new Set(rows.map((r) => r.trackKey));
}

async function memberships(ctx: GeneratorContext, groupMbid: string): Promise<Relation[]> {
  return ctx.db
    .select()
    .from(schema.mbArtistRelations)
    .where(and(eq(schema.mbArtistRelations.entity1Mbid, groupMbid), eq(schema.mbArtistRelations.typeId, ARTIST_RELATION_TYPE_ID.MEMBER_OF_BAND)));
}

/** All groups these people belong to, excluding `exceptGroup`. */
async function bandsOf(ctx: GeneratorContext, personMbids: string[], exceptGroup: string): Promise<Relation[]> {
  if (personMbids.length === 0) return [];
  return ctx.db
    .select()
    .from(schema.mbArtistRelations)
    .where(and(inArray(schema.mbArtistRelations.entity0Mbid, personMbids), eq(schema.mbArtistRelations.typeId, ARTIST_RELATION_TYPE_ID.MEMBER_OF_BAND), ne(schema.mbArtistRelations.entity1Mbid, exceptGroup)));
}

/** Groups in the user's library that share no member with any of `personMbids` (safe distractors). */
async function unrelatedLibraryGroups(ctx: GeneratorContext, artists: TriviaArtist[], anchor: TriviaArtist, personMbids: string[], limit: number): Promise<TriviaArtist[]> {
  const candidates = artists.filter((a) => a.mbid !== anchor.mbid && a.type === 'Group');
  if (candidates.length === 0) return [];
  const linked = personMbids.length
    ? await ctx.db
        .select({ group: schema.mbArtistRelations.entity1Mbid })
        .from(schema.mbArtistRelations)
        .where(and(inArray(schema.mbArtistRelations.entity0Mbid, personMbids), eq(schema.mbArtistRelations.typeId, ARTIST_RELATION_TYPE_ID.MEMBER_OF_BAND)))
    : [];
  const linkedSet = new Set(linked.map((l) => l.group));
  return ctx.rng.shuffle(candidates.filter((c) => !linkedSet.has(c.mbid))).slice(0, limit);
}

// ------------------------------------------------------------------ generators

type Generator = (ctx: GeneratorContext, anchor: TriviaArtist, artists: TriviaArtist[]) => Promise<GeneratedQuestion | null>;

const GENERATORS: Record<SideBCategory, Generator> = {
  disco_order_albums: async (ctx, anchor) => {
    const albums = await studioAlbums(ctx, anchor.mbid);
    const distinctYears = albums.filter((a, i, arr) => arr.findIndex((b) => b.firstReleaseYear === a.firstReleaseYear) === i);
    if (distinctYears.length < 3) return null;
    const count = anchor.difficulty === 'easy' || anchor.difficulty === 'medium' ? 3 : Math.min(4, distinctYears.length);
    const chosen = ctx.rng.shuffle(distinctYears).slice(0, count).sort((a, b) => a.firstReleaseYear! - b.firstReleaseYear!);
    const options = chosen.map((a) => ({ id: optionIdFor(ctx, a.mbid), label: a.title }));
    const shuffled = ctx.rng.shuffle(options);
    return buildQuestion({
      category: 'disco_order_albums',
      templateId: 'disco_order_albums.v1',
      difficulty: anchor.difficulty,
      answerFormat: 'order',
      prompt: `Put these ${anchor.mbName} albums in release order, oldest first.`,
      hint: null,
      options: shuffled,
      correctAnswer: { order: options.map((o) => o.id) },
      correctDisplay: chosen.map((a) => `${a.title} (${a.firstReleaseYear})`).join(' → '),
      anchorArtistKey: anchor.artistKey,
      anchorArtistMbid: anchor.mbid,
      factRefs: chosen.map((a) => ({ table: 'mb_release_groups', mbid: a.mbid, firstReleaseDate: a.firstReleaseDate })),
    });
  },

  disco_release_year: async (ctx, anchor) => {
    const albums = (await studioAlbums(ctx, anchor.mbid)).filter((a) => a.firstReleaseYear !== null);
    if (albums.length === 0) return null;
    const album = ctx.rng.pick(albums);
    const tolerance = anchor.difficulty === 'easy' ? 1 : 0;
    return buildQuestion({
      category: 'disco_release_year',
      templateId: 'disco_release_year.v1',
      difficulty: anchor.difficulty,
      answerFormat: 'numeric',
      prompt: `In which year was ${album.title} by ${anchor.mbName} first released?`,
      hint: tolerance ? 'Within a year counts.' : 'Exact year.',
      unit: UNIT_YEAR,
      correctAnswer: { value: album.firstReleaseYear },
      correctDisplay: album.firstReleaseDate.length === 10 ? `${album.firstReleaseYear} (${album.firstReleaseDate})` : String(album.firstReleaseYear),
      numericAnswer: album.firstReleaseYear,
      numericTolerance: tolerance,
      anchorArtistKey: anchor.artistKey,
      anchorArtistMbid: anchor.mbid,
      anchorReleaseGroupMbid: album.mbid,
      anchorYear: album.firstReleaseYear,
      factRefs: [{ table: 'mb_release_groups', mbid: album.mbid, firstReleaseDate: album.firstReleaseDate }],
    });
  },

  titles_album_contains_track: async (ctx, anchor) => {
    const withTracks = await albumsWithTracklists(ctx, anchor.mbid);
    if (withTracks.length < 3) return null;
    const played = await playedTrackKeys(ctx, anchor.artistKey);
    // A title that appears on more than one canonical tracklist is ambiguous.
    const titleCounts = new Map<string, number>();
    for (const { tracks } of withTracks) for (const t of tracks) titleCounts.set(t.titleKey, (titleCounts.get(t.titleKey) ?? 0) + 1);
    const pool = withTracks.flatMap(({ album, tracks }) => tracks.filter((t) => titleCounts.get(t.titleKey) === 1 && !t.isOpener).map((track) => ({ album, track })));
    if (pool.length === 0) return null;
    const familiar = pool.filter((p) => played.has(p.track.titleKey));
    const { album, track } = ctx.rng.pick(familiar.length > 0 ? familiar : pool);
    const others = ctx.rng.shuffle(withTracks.filter((w) => w.album.mbid !== album.mbid)).slice(0, 3);
    const options = ctx.rng.shuffle([album, ...others.map((o) => o.album)].map((a) => ({ id: optionIdFor(ctx, a.mbid), label: a.title })));
    const correct = options.find((o) => o.label === album.title)!;
    return buildQuestion({
      category: 'titles_album_contains_track',
      templateId: 'titles_album_contains_track.v1',
      difficulty: anchor.difficulty,
      answerFormat: 'multiple_choice',
      prompt: `Which ${anchor.mbName} album has the track "${track.title}"?`,
      hint: null,
      options,
      correctAnswer: { optionId: correct.id },
      correctDisplay: `${album.title} (track ${track.absolutePosition})`,
      anchorArtistKey: anchor.artistKey,
      anchorArtistMbid: anchor.mbid,
      anchorReleaseGroupMbid: album.mbid,
      anchorRecordingMbid: track.recordingMbid,
      factRefs: [{ table: 'mb_tracks', mbid: track.mbid, release: track.releaseMbid }],
    });
  },

  titles_album_opener: (ctx, anchor) => openerOrCloser(ctx, anchor, 'opener'),
  titles_album_closer: (ctx, anchor) => openerOrCloser(ctx, anchor, 'closer'),

  cross_shared_members: async (ctx, anchor, artists) => {
    if (anchor.type !== 'Group') return null;
    const members = await memberships(ctx, anchor.mbid);
    const people = [...new Set(members.map((m) => m.entity0Mbid))];
    if (people.length === 0) return null;
    const elsewhere = await bandsOf(ctx, people, anchor.mbid);
    if (elsewhere.length === 0) return null;
    const preferred = elsewhere.filter((r) => artists.some((a) => a.mbid === r.entity1Mbid));
    const link = ctx.rng.pick(preferred.length > 0 ? preferred : elsewhere);
    const distractors = await unrelatedLibraryGroups(ctx, artists, anchor, people, 3);
    if (distractors.length < 2) return null;
    const options = ctx.rng.shuffle([{ id: optionIdFor(ctx, link.entity1Mbid), label: link.entity1Name }, ...distractors.map((d) => ({ id: optionIdFor(ctx, d.mbid), label: d.mbName }))]);
    const correct = options.find((o) => o.label === link.entity1Name)!;
    return buildQuestion({
      category: 'cross_shared_members',
      templateId: 'cross_shared_members.v1',
      difficulty: anchor.difficulty,
      answerFormat: 'multiple_choice',
      prompt: `Which of these bands shares a member with ${anchor.mbName}?`,
      hint: null,
      options,
      correctAnswer: { optionId: correct.id },
      correctDisplay: link.entity1Name,
      explanation: `${link.entity0Name} has played in both.`,
      anchorArtistKey: anchor.artistKey,
      anchorArtistMbid: anchor.mbid,
      factRefs: [{ table: 'mb_artist_relations', id: link.id }],
    });
  },

  cross_side_project: async (ctx, anchor, artists) => {
    if (anchor.type !== 'Group') return null;
    const members = await memberships(ctx, anchor.mbid);
    const people = [...new Set(members.map((m) => m.entity0Mbid))];
    if (people.length === 0) return null;
    const elsewhere = await bandsOf(ctx, people, anchor.mbid);
    if (elsewhere.length === 0) return null;
    const link = ctx.rng.pick(elsewhere);
    const distractors = await unrelatedLibraryGroups(ctx, artists, anchor, [link.entity0Mbid], 3);
    if (distractors.length < 2) return null;
    const options = ctx.rng.shuffle([{ id: optionIdFor(ctx, link.entity1Mbid), label: link.entity1Name }, ...distractors.map((d) => ({ id: optionIdFor(ctx, d.mbid), label: d.mbName }))]);
    const correct = options.find((o) => o.label === link.entity1Name)!;
    return buildQuestion({
      category: 'cross_side_project',
      templateId: 'cross_side_project.v1',
      difficulty: anchor.difficulty,
      answerFormat: 'multiple_choice',
      prompt: `${link.entity0Name} of ${anchor.mbName} is also a member of which band?`,
      hint: null,
      options,
      correctAnswer: { optionId: correct.id },
      correctDisplay: link.entity1Name,
      explanation: link.beginYear ? `Member since ${link.beginYear}${link.endYear ? ` until ${link.endYear}` : ''}.` : null,
      anchorArtistKey: anchor.artistKey,
      anchorArtistMbid: anchor.mbid,
      factRefs: [{ table: 'mb_artist_relations', id: link.id }],
    });
  },

  cross_member_joined_left: async (ctx, anchor) => {
    if (anchor.type !== 'Group') return null;
    const members = await memberships(ctx, anchor.mbid);
    const left = members.filter((m) => m.ended && m.endYear !== null);
    const joined = members.filter((m) => m.beginYear !== null && !m.isOriginal);
    const events = [...left.map((m) => ({ m, kind: 'left' as const, year: m.endYear! })), ...joined.map((m) => ({ m, kind: 'joined' as const, year: m.beginYear! }))];
    if (events.length === 0) return null;
    const event = ctx.rng.pick(events);
    return buildQuestion({
      category: 'cross_member_joined_left',
      templateId: 'cross_member_joined_left.v1',
      difficulty: anchor.difficulty,
      answerFormat: 'numeric',
      prompt: `In which year did ${event.m.entity0Name} ${event.kind === 'left' ? 'leave' : 'join'} ${anchor.mbName}?`,
      hint: 'Within a year counts.',
      unit: UNIT_YEAR,
      correctAnswer: { value: event.year },
      correctDisplay: `${event.year}${event.m.beginYear && event.m.endYear ? ` (member ${event.m.beginYear} to ${event.m.endYear})` : ''}`,
      numericAnswer: event.year,
      numericTolerance: 1,
      anchorArtistKey: anchor.artistKey,
      anchorArtistMbid: anchor.mbid,
      anchorYear: event.year,
      factRefs: [{ table: 'mb_artist_relations', id: event.m.id }],
    });
  },

  duration_track_runtime: async (ctx, anchor) => {
    const withTracks = await albumsWithTracklists(ctx, anchor.mbid);
    const played = await playedTrackKeys(ctx, anchor.artistKey);
    const pool = withTracks.flatMap(({ album, tracks }) => tracks.filter((t) => t.lengthMs !== null && t.lengthMs > 30_000).map((track) => ({ album, track })));
    if (pool.length === 0) return null;
    const familiar = pool.filter((p) => played.has(p.track.titleKey));
    const { album, track } = ctx.rng.pick(familiar.length > 0 ? familiar : pool);
    const seconds = Math.round(track.lengthMs! / 1000);
    const tolerance = Math.max(15, Math.round(seconds * 0.08));
    return buildQuestion({
      category: 'duration_track_runtime',
      templateId: 'duration_track_runtime.v1',
      difficulty: anchor.difficulty,
      answerFormat: 'numeric',
      prompt: `How long is "${track.title}" on ${album.title}?`,
      hint: `Answer as minutes:seconds. Within ${tolerance} seconds counts.`,
      unit: UNIT_DURATION,
      correctAnswer: { value: seconds },
      correctDisplay: formatDuration(seconds),
      numericAnswer: seconds,
      numericTolerance: tolerance,
      anchorArtistKey: anchor.artistKey,
      anchorArtistMbid: anchor.mbid,
      anchorReleaseGroupMbid: album.mbid,
      anchorRecordingMbid: track.recordingMbid,
      factRefs: [{ table: 'mb_tracks', mbid: track.mbid, lengthMs: track.lengthMs }],
    });
  },

  // Optional toggles: need Wikidata enrichment; not generated yet.
  geo_origin: async () => null,
  producer: async () => null,
  label: async () => null,
};

async function openerOrCloser(ctx: GeneratorContext, anchor: TriviaArtist, which: 'opener' | 'closer'): Promise<GeneratedQuestion | null> {
  const withTracks = (await albumsWithTracklists(ctx, anchor.mbid)).filter((w) => w.tracks.length >= 4);
  if (withTracks.length === 0) return null;
  const { album, tracks } = ctx.rng.pick(withTracks);
  const target = tracks.find((t) => (which === 'opener' ? t.isOpener : t.isCloser));
  if (!target) return null;
  const others = ctx.rng.shuffle(tracks.filter((t) => t.mbid !== target.mbid && t.titleKey !== target.titleKey)).slice(0, 3);
  if (others.length < 3) return null;
  const options = ctx.rng.shuffle([target, ...others].map((t) => ({ id: optionIdFor(ctx, t.mbid), label: stripEditionSuffix(t.title) || t.title })));
  const correct = options.find((o) => o.label === (stripEditionSuffix(target.title) || target.title))!;
  return buildQuestion({
    category: which === 'opener' ? 'titles_album_opener' : 'titles_album_closer',
    templateId: `titles_album_${which}.v1`,
    difficulty: anchor.difficulty,
    answerFormat: 'multiple_choice',
    prompt: which === 'opener' ? `Which track opens ${album.title} by ${anchor.mbName}?` : `Which track closes ${album.title} by ${anchor.mbName}?`,
    hint: null,
    options,
    correctAnswer: { optionId: correct.id },
    correctDisplay: `${target.title} (track ${target.absolutePosition} of ${tracks.length})`,
    anchorArtistKey: anchor.artistKey,
    anchorArtistMbid: anchor.mbid,
    anchorReleaseGroupMbid: album.mbid,
    anchorRecordingMbid: target.recordingMbid,
    factRefs: [{ table: 'mb_tracks', mbid: target.mbid }],
  });
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

