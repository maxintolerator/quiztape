import { schema } from '@quiztape/db';
import { type Difficulty, DIFFICULTIES, MIN_PLAYS_FOR_QUESTIONS, type QuestionOption, SIDE_A_CATEGORIES, type SideACategory } from '@quiztape/shared';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import { stripEditionSuffix } from './normalize';
import type { GeneratedQuestion, GeneratorContext } from './types';

type ArtistStat = typeof schema.userArtistStats.$inferSelect;

/**
 * Side A: pure functions over the user's rollups. Each generator returns null
 * when the data cannot support an unambiguous question, and the round builder
 * moves on to another anchor or category.
 */
export async function generateSideAQuestions(ctx: GeneratorContext, options: { difficulty: Difficulty; count: number }): Promise<GeneratedQuestion[]> {
  // Only artists with real listening behind them; ranks stay global so "#12" still means #12 overall.
  const artists = await ctx.db
    .select()
    .from(schema.userArtistStats)
    .where(and(eq(schema.userArtistStats.userId, ctx.userId), gte(schema.userArtistStats.playCount, MIN_PLAYS_FOR_QUESTIONS)))
    .orderBy(schema.userArtistStats.rank);
  if (artists.length === 0) return [];

  const questions: GeneratedQuestion[] = [];
  const categories = ctx.rng.shuffle(SIDE_A_CATEGORIES);
  let categoryIndex = 0;
  let attempts = 0;
  const maxAttempts = options.count * 12;

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

/** Mostly the requested tier, sometimes a neighbour, never an artist already used this round. */
function pickAnchor(ctx: GeneratorContext, artists: ArtistStat[], difficulty: Difficulty): ArtistStat | null {
  const available = artists.filter((a) => !ctx.usedArtistKeys.has(a.artistKey));
  if (available.length === 0) return null;
  const tierIndex = DIFFICULTIES.indexOf(difficulty);
  const roll = ctx.rng.next();
  const wanted: Difficulty[] =
    roll < 0.7 ? [difficulty] : roll < 0.85 ? [DIFFICULTIES[Math.max(0, tierIndex - 1)]!] : [DIFFICULTIES[Math.min(DIFFICULTIES.length - 1, tierIndex + 1)]!];
  const pool = available.filter((a) => wanted.includes(a.difficulty));
  return ctx.rng.pick(pool.length > 0 ? pool : available);
}

type Generator = (ctx: GeneratorContext, anchor: ArtistStat, artists: ArtistStat[]) => Promise<GeneratedQuestion | null>;

const GENERATORS: Record<SideACategory, Generator> = {
  stats_artist_rank: async (_ctx, anchor) => {
    const rank = anchor.rank;
    const tolerance = rank <= 10 ? 1 : rank <= 50 ? 3 : rank <= 200 ? 10 : Math.max(10, Math.round(rank * 0.1));
    return build({
      category: 'stats_artist_rank',
      templateId: 'stats_artist_rank.v1',
      difficulty: anchor.difficulty,
      answerFormat: 'numeric',
      prompt: `Where does ${anchor.artistName} sit in your all-time most played artists?`,
      hint: tolerance > 1 ? `Within ${tolerance} places counts.` : 'Exact or one place off counts.',
      unit: 'rank',
      correctAnswer: { value: rank },
      correctDisplay: `#${rank} (${anchor.playCount.toLocaleString()} plays)`,
      numericAnswer: rank,
      numericTolerance: tolerance,
      anchorArtistKey: anchor.artistKey,
      factRefs: [{ table: 'user_artist_stats', artistKey: anchor.artistKey }],
    });
  },

  stats_top_track_for_artist: async (ctx, anchor) => {
    if (anchor.distinctTracks < 3) return null;
    const top = await ctx.db
      .select()
      .from(schema.userTrackStats)
      .where(and(eq(schema.userTrackStats.userId, ctx.userId), eq(schema.userTrackStats.artistKey, anchor.artistKey)))
      .orderBy(schema.userTrackStats.rankInArtist)
      .limit(2);
    const [first, second] = top;
    if (!first || !second || first.playCount <= second.playCount) return null;
    return build({
      category: 'stats_top_track_for_artist',
      templateId: 'stats_top_track_for_artist.v1',
      difficulty: anchor.difficulty,
      answerFormat: 'free_text',
      prompt: `What is your most played ${anchor.artistName} track?`,
      hint: `${first.playCount.toLocaleString()} plays, ahead of the runner-up by ${(first.playCount - second.playCount).toLocaleString()}.`,
      correctAnswer: { text: first.trackName },
      correctDisplay: `${first.trackName} (${first.playCount.toLocaleString()} plays)`,
      acceptedAnswers: accepted(first.trackName),
      anchorArtistKey: anchor.artistKey,
      factRefs: [{ table: 'user_track_stats', artistKey: anchor.artistKey, trackKey: first.trackKey }],
    });
  },

  stats_top_album: async (ctx, anchor) => {
    if (anchor.distinctAlbums < 2) return null;
    const top = await ctx.db
      .select()
      .from(schema.userAlbumStats)
      .where(and(eq(schema.userAlbumStats.userId, ctx.userId), eq(schema.userAlbumStats.artistKey, anchor.artistKey)))
      .orderBy(schema.userAlbumStats.rankInArtist)
      .limit(2);
    const [first, second] = top;
    if (!first || !second || first.playCount <= second.playCount) return null;
    return build({
      category: 'stats_top_album',
      templateId: 'stats_top_album.v1',
      difficulty: anchor.difficulty,
      answerFormat: 'free_text',
      prompt: `Which ${anchor.artistName} album have you played the most?`,
      hint: `You have played tracks from ${anchor.distinctAlbums} of their albums.`,
      correctAnswer: { text: first.albumName },
      correctDisplay: `${first.albumName} (${first.playCount.toLocaleString()} plays)`,
      acceptedAnswers: accepted(first.albumName),
      anchorArtistKey: anchor.artistKey,
      factRefs: [{ table: 'user_album_stats', artistKey: anchor.artistKey, albumKey: first.albumKey }],
    });
  },

  stats_discovery_order: async (ctx, anchor, artists) => {
    const others = ctx.rng.shuffle(artists.filter((a) => a.artistKey !== anchor.artistKey && !ctx.usedArtistKeys.has(a.artistKey))).slice(0, 12);
    const candidates = [anchor, ...others]
      .filter((a, i, arr) => arr.findIndex((b) => Math.abs(b.firstPlayedAt.getTime() - a.firstPlayedAt.getTime()) < 30 * 86_400_000) === i)
      .slice(0, 4);
    if (candidates.length < 3) return null;
    const earliest = candidates.reduce((min, a) => (a.firstPlayedAt < min.firstPlayedAt ? a : min));
    const options = ctx.rng.shuffle(candidates).map((a) => ({ id: optionId(ctx, a.artistKey), label: a.artistName }));
    const correct = options.find((o) => o.label === earliest.artistName)!;
    return build({
      category: 'stats_discovery_order',
      templateId: 'stats_discovery_order.v1',
      difficulty: anchor.difficulty,
      answerFormat: 'multiple_choice',
      prompt: 'Which of these did you discover first?',
      hint: null,
      options,
      correctAnswer: { optionId: correct.id },
      correctDisplay: `${earliest.artistName} (first played ${formatMonth(earliest.firstPlayedAt)})`,
      explanation: candidates
        .slice()
        .sort((a, b) => a.firstPlayedAt.getTime() - b.firstPlayedAt.getTime())
        .map((a) => `${a.artistName}: ${formatMonth(a.firstPlayedAt)}`)
        .join(' · '),
      anchorArtistKey: anchor.artistKey,
      factRefs: candidates.map((a) => ({ table: 'user_artist_stats', artistKey: a.artistKey, firstPlayedAt: a.firstPlayedAt.toISOString() })),
    });
  },

  stats_year_chart_topper: async (ctx, anchor) => {
    // Pick a year where this anchor is involved, else any year with a clear winner.
    const years = await ctx.db
      .select({ year: schema.userYearArtistStats.year, artistKey: schema.userYearArtistStats.artistKey, playCount: schema.userYearArtistStats.playCount, rankInYear: schema.userYearArtistStats.rankInYear })
      .from(schema.userYearArtistStats)
      .where(and(eq(schema.userYearArtistStats.userId, ctx.userId), inArray(schema.userYearArtistStats.rankInYear, [1, 2])))
      .orderBy(desc(schema.userYearArtistStats.year));
    const byYear = new Map<number, { first?: (typeof years)[number]; second?: (typeof years)[number] }>();
    for (const row of years) {
      const entry = byYear.get(row.year) ?? {};
      if (row.rankInYear === 1) entry.first = row;
      else entry.second = row;
      byYear.set(row.year, entry);
    }
    const clear = [...byYear.entries()].filter(
      ([, e]) => e.first && e.first.playCount >= MIN_PLAYS_FOR_QUESTIONS && (!e.second || e.first.playCount >= e.second.playCount * 1.2),
    );
    if (clear.length === 0) return null;
    const preferred = clear.filter(([, e]) => e.first!.artistKey === anchor.artistKey);
    const [year, entry] = ctx.rng.pick(preferred.length > 0 ? preferred : clear);
    const [winner] = await ctx.db
      .select({ artistName: schema.userArtistStats.artistName })
      .from(schema.userArtistStats)
      .where(and(eq(schema.userArtistStats.userId, ctx.userId), eq(schema.userArtistStats.artistKey, entry.first!.artistKey)))
      .limit(1);
    if (!winner) return null;
    return build({
      category: 'stats_year_chart_topper',
      templateId: 'stats_year_chart_topper.v1',
      difficulty: anchor.difficulty,
      answerFormat: 'free_text',
      prompt: `Who was your most played artist in ${year}?`,
      hint: `${entry.first!.playCount.toLocaleString()} plays that year.`,
      correctAnswer: { text: winner.artistName },
      correctDisplay: `${winner.artistName} (${entry.first!.playCount.toLocaleString()} plays in ${year})`,
      acceptedAnswers: accepted(winner.artistName),
      anchorArtistKey: entry.first!.artistKey,
      anchorYear: year,
      factRefs: [{ table: 'user_year_artist_stats', year, artistKey: entry.first!.artistKey }],
    });
  },

  stats_head_to_head: async (ctx, anchor, artists) => {
    const rivals = artists.filter(
      (a) =>
        a.artistKey !== anchor.artistKey &&
        !ctx.usedArtistKeys.has(a.artistKey) &&
        Math.abs(a.playCount - anchor.playCount) >= Math.max(5, Math.round(Math.max(a.playCount, anchor.playCount) * 0.2)) &&
        Math.abs(a.rank - anchor.rank) <= Math.max(10, Math.round(anchor.rank * 0.5)),
    );
    if (rivals.length === 0) return null;
    const rival = ctx.rng.pick(rivals);
    const pair = ctx.rng.shuffle([anchor, rival]);
    const options = pair.map((a) => ({ id: optionId(ctx, a.artistKey), label: a.artistName }));
    const winner = anchor.playCount > rival.playCount ? anchor : rival;
    const correct = options.find((o) => o.label === winner.artistName)!;
    return build({
      category: 'stats_head_to_head',
      templateId: 'stats_head_to_head.v1',
      difficulty: anchor.difficulty,
      answerFormat: 'multiple_choice',
      prompt: 'Which one have you played more?',
      hint: null,
      options,
      correctAnswer: { optionId: correct.id },
      correctDisplay: `${winner.artistName}`,
      explanation: `${anchor.artistName}: ${anchor.playCount.toLocaleString()} plays · ${rival.artistName}: ${rival.playCount.toLocaleString()} plays`,
      anchorArtistKey: anchor.artistKey,
      factRefs: [anchor, rival].map((a) => ({ table: 'user_artist_stats', artistKey: a.artistKey, playCount: a.playCount })),
    });
  },
};

// ------------------------------------------------------------------ helpers

type BuildInput = Partial<GeneratedQuestion> & Pick<GeneratedQuestion, 'category' | 'templateId' | 'answerFormat' | 'prompt' | 'correctAnswer' | 'correctDisplay'>;

function build(input: BuildInput): GeneratedQuestion {
  return buildQuestion(input);
}

/** Fill defaults and compute the fingerprint. Shared with Side B. */
export function buildQuestion(input: BuildInput): GeneratedQuestion {
  const question: GeneratedQuestion = {
    difficulty: 'medium',
    hint: null,
    options: null,
    unit: null,
    explanation: null,
    acceptedAnswers: [],
    numericAnswer: null,
    numericTolerance: null,
    anchorArtistKey: null,
    anchorArtistMbid: null,
    anchorReleaseGroupMbid: null,
    anchorRecordingMbid: null,
    anchorYear: null,
    factRefs: [],
    fingerprint: '',
    ...input,
  };
  question.fingerprint = fingerprint(question);
  return question;
}

function fingerprint(q: GeneratedQuestion): string {
  const material = JSON.stringify([
    q.templateId,
    q.anchorArtistKey,
    q.anchorArtistMbid,
    q.anchorReleaseGroupMbid,
    q.anchorRecordingMbid,
    q.anchorYear,
    q.correctDisplay,
    (q.options ?? []).map((o) => o.label).sort(),
  ]);
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

export function optionIdFor(ctx: GeneratorContext, seed: string): string {
  return optionId(ctx, seed);
}

function accepted(name: string): string[] {
  const stripped = stripEditionSuffix(name);
  return stripped && stripped !== name ? [name, stripped] : [name];
}

function optionId(ctx: GeneratorContext, seed: string): string {
  return createHash('sha256').update(`${seed}:${ctx.rng.next()}`).digest('hex').slice(0, 10);
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Artists with enough plays to be asked about, used for the "library too thin" check. */
export async function countEligibleArtists(db: GeneratorContext['db'], userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.userArtistStats)
    .where(and(eq(schema.userArtistStats.userId, userId), gte(schema.userArtistStats.playCount, MIN_PLAYS_FOR_QUESTIONS)));
  return row?.n ?? 0;
}
