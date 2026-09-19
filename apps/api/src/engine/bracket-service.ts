import { schema } from '@quiztape/db';
import {
  BRACKET_SIZES,
  type BracketDto,
  type BracketEntrantDto,
  type BracketMatchDto,
  type BracketSize,
  type BracketStateDto,
  type DuelResultDto,
  MIN_PLAYS_FOR_QUESTIONS,
  seedingOrder,
} from '@quiztape/shared';
import { and, eq, gte } from 'drizzle-orm';

import type { Services } from '../services';
import { RoundError } from './round-service';

type BracketRow = typeof schema.brackets.$inferSelect;
type MatchRow = typeof schema.bracketMatches.$inferSelect;
type EntrantRow = typeof schema.bracketEntrants.$inferSelect;

/**
 * Single elimination seeded from the user's most played artists. Each match
 * has two beats: a duel ("which did you play more?", scored against the
 * rollups) and a pick (who advances, the player's call). The champion is
 * therefore the player's favourite, the duel score is their recall.
 */
export async function createBracket(services: Services, userId: string, requested: BracketSize): Promise<BracketStateDto> {
  const { db, now } = services;
  const [sync] = await db.select().from(schema.userSyncState).where(eq(schema.userSyncState.userId, userId)).limit(1);
  if (!sync || sync.phase !== 'complete' || !sync.statsBuiltAt) throw new RoundError(409, 'library_not_ready', 'Your listening history is still syncing.');

  const top = await db
    .select()
    .from(schema.userArtistStats)
    .where(and(eq(schema.userArtistStats.userId, userId), gte(schema.userArtistStats.playCount, MIN_PLAYS_FOR_QUESTIONS)))
    .orderBy(schema.userArtistStats.rank)
    .limit(Math.max(...BRACKET_SIZES));
  const size = [...BRACKET_SIZES].reverse().find((s) => s <= requested && s <= top.length) ?? null;
  if (!size) throw new RoundError(409, 'library_too_thin', `A bracket needs at least ${BRACKET_SIZES[0]} artists with ${MIN_PLAYS_FOR_QUESTIONS}+ plays; you have ${top.length}.`);
  const roundCount = Math.log2(size);
  const current = now();

  const state = await db.transaction(async (tx) => {
    const [bracket] = await tx
      .insert(schema.brackets)
      .values({ userId, size, roundCount, status: 'active', currentRound: 1, statsSnapshotAt: sync.statsBuiltThrough, createdAt: current })
      .returning();
    await tx.insert(schema.bracketEntrants).values(
      top.slice(0, size).map((artist, index) => ({
        bracketId: bracket!.id,
        seed: index + 1,
        artistKey: artist.artistKey,
        artistName: artist.artistName,
        playCount: artist.playCount,
      })),
    );
    // All matches up front, then wire each to the match it feeds.
    const inserted: MatchRow[] = [];
    const order = seedingOrder(size);
    for (let roundNo = 1; roundNo <= roundCount; roundNo++) {
      const count = size / 2 ** roundNo;
      const rows = await tx
        .insert(schema.bracketMatches)
        .values(
          Array.from({ length: count }, (_, matchNo) => ({
            bracketId: bracket!.id,
            roundNo,
            matchNo,
            seedA: roundNo === 1 ? order[matchNo * 2]! : null,
            seedB: roundNo === 1 ? order[matchNo * 2 + 1]! : null,
          })),
        )
        .returning();
      inserted.push(...rows);
    }
    for (const match of inserted) {
      if (match.roundNo === roundCount) continue;
      const next = inserted.find((m) => m.roundNo === match.roundNo + 1 && m.matchNo === Math.floor(match.matchNo / 2))!;
      await tx.update(schema.bracketMatches).set({ nextMatchId: next.id, nextSlot: (match.matchNo % 2) + 1 }).where(eq(schema.bracketMatches.id, match.id));
    }
    return bracket!;
  });
  return getBracketState(services, userId, state.id);
}

export async function getBracketState(services: Services, userId: string, bracketId: string): Promise<BracketStateDto> {
  const bracket = await loadBracket(services, userId, bracketId);
  const entrants = await services.db.select().from(schema.bracketEntrants).where(eq(schema.bracketEntrants.bracketId, bracketId)).orderBy(schema.bracketEntrants.seed);
  const matches = await loadMatches(services, bracketId);
  return {
    bracket: toBracketDto(bracket),
    entrants: entrants.map((e) => toEntrantDto(e, bracket.status === 'completed')),
    matches: matches.map(toMatchDto),
    current: currentMatch(matches),
  };
}

export async function answerDuel(services: Services, userId: string, bracketId: string, matchId: string, guessSeed: number): Promise<DuelResultDto> {
  const { db, now } = services;
  const bracket = await loadBracket(services, userId, bracketId);
  if (bracket.status !== 'active') throw new RoundError(409, 'bracket_not_active', 'This bracket is over.');
  const matches = await loadMatches(services, bracketId);
  const current = currentMatch(matches);
  const match = matches.find((m) => m.id === matchId);
  if (!match || !current || current.id !== match.id) throw new RoundError(409, 'wrong_match', 'That is not the match waiting for you.');
  if (match.duelGuessSeed !== null) throw new RoundError(409, 'duel_answered', 'The duel for this match is already answered.');
  if (guessSeed !== match.seedA && guessSeed !== match.seedB) throw new RoundError(400, 'invalid_seed', 'Guess one of the two artists in the match.');

  const entrants = await db.select().from(schema.bracketEntrants).where(eq(schema.bracketEntrants.bracketId, bracketId));
  const a = entrants.find((e) => e.seed === match.seedA)!;
  const b = entrants.find((e) => e.seed === match.seedB)!;
  const morePlayedSeed = a.playCount >= b.playCount ? a.seed : b.seed;
  const correct = guessSeed === morePlayedSeed || a.playCount === b.playCount;
  const when = now();
  const [updatedMatch] = await db
    .update(schema.bracketMatches)
    .set({ duelGuessSeed: guessSeed, duelCorrect: correct, duelAnsweredAt: when })
    .where(eq(schema.bracketMatches.id, match.id))
    .returning();
  const [updatedBracket] = await db
    .update(schema.brackets)
    .set({ duelsTotal: bracket.duelsTotal + 1, duelsCorrect: bracket.duelsCorrect + (correct ? 1 : 0) })
    .where(eq(schema.brackets.id, bracketId))
    .returning();
  return { match: toMatchDto(updatedMatch!), correct, morePlayedSeed, playsA: a.playCount, playsB: b.playCount, bracket: toBracketDto(updatedBracket!) };
}

export async function pickWinner(services: Services, userId: string, bracketId: string, matchId: string, winnerSeed: number): Promise<BracketStateDto> {
  const { db, now } = services;
  const bracket = await loadBracket(services, userId, bracketId);
  if (bracket.status !== 'active') throw new RoundError(409, 'bracket_not_active', 'This bracket is over.');
  const matches = await loadMatches(services, bracketId);
  const current = currentMatch(matches);
  const match = matches.find((m) => m.id === matchId);
  if (!match || !current || current.id !== match.id) throw new RoundError(409, 'wrong_match', 'That is not the match waiting for you.');
  if (match.duelGuessSeed === null) throw new RoundError(409, 'duel_first', 'Answer the duel before picking who advances.');
  if (winnerSeed !== match.seedA && winnerSeed !== match.seedB) throw new RoundError(400, 'invalid_seed', 'Pick one of the two artists in the match.');
  const loserSeed = winnerSeed === match.seedA ? match.seedB! : match.seedA!;
  const when = now();

  await db.transaction(async (tx) => {
    await tx.update(schema.bracketMatches).set({ winnerSeed, pickedAt: when }).where(eq(schema.bracketMatches.id, match.id));
    await tx.update(schema.bracketEntrants).set({ eliminatedInRound: match.roundNo }).where(and(eq(schema.bracketEntrants.bracketId, bracketId), eq(schema.bracketEntrants.seed, loserSeed)));
    if (match.nextMatchId) {
      await tx
        .update(schema.bracketMatches)
        .set(match.nextSlot === 1 ? { seedA: winnerSeed } : { seedB: winnerSeed })
        .where(eq(schema.bracketMatches.id, match.nextMatchId));
      const roundDone = matches.filter((m) => m.roundNo === match.roundNo).every((m) => m.id === match.id || m.winnerSeed !== null);
      if (roundDone) await tx.update(schema.brackets).set({ currentRound: match.roundNo + 1 }).where(eq(schema.brackets.id, bracketId));
    } else {
      await tx.update(schema.brackets).set({ status: 'completed', championSeed: winnerSeed, completedAt: when }).where(eq(schema.brackets.id, bracketId));
    }
  });
  return getBracketState(services, userId, bracketId);
}

// ------------------------------------------------------------------ helpers

async function loadBracket(services: Services, userId: string, bracketId: string): Promise<BracketRow> {
  const [bracket] = await services.db
    .select()
    .from(schema.brackets)
    .where(and(eq(schema.brackets.id, bracketId), eq(schema.brackets.userId, userId)))
    .limit(1);
  if (!bracket) throw new RoundError(404, 'bracket_not_found', 'No such bracket.');
  return bracket;
}

async function loadMatches(services: Services, bracketId: string): Promise<MatchRow[]> {
  return services.db
    .select()
    .from(schema.bracketMatches)
    .where(eq(schema.bracketMatches.bracketId, bracketId))
    .orderBy(schema.bracketMatches.roundNo, schema.bracketMatches.matchNo);
}

function currentMatch(matches: MatchRow[]): BracketMatchDto | null {
  const next = matches.find((m) => m.winnerSeed === null && m.seedA !== null && m.seedB !== null);
  return next ? toMatchDto(next) : null;
}

function toMatchDto(m: MatchRow): BracketMatchDto {
  return { id: m.id, roundNo: m.roundNo, matchNo: m.matchNo, seedA: m.seedA, seedB: m.seedB, winnerSeed: m.winnerSeed, duelGuessSeed: m.duelGuessSeed, duelCorrect: m.duelCorrect };
}

function toEntrantDto(e: EntrantRow, revealPlays: boolean): BracketEntrantDto {
  return { seed: e.seed, artistName: e.artistName, rank: e.seed, playCount: revealPlays ? e.playCount : null, eliminatedInRound: e.eliminatedInRound };
}

export function toBracketDto(b: BracketRow): BracketDto {
  return {
    id: b.id,
    size: b.size,
    roundCount: b.roundCount,
    status: b.status,
    currentRound: b.currentRound,
    championSeed: b.championSeed,
    duelsCorrect: b.duelsCorrect,
    duelsTotal: b.duelsTotal,
    createdAt: b.createdAt.toISOString(),
    completedAt: b.completedAt?.toISOString() ?? null,
  };
}
