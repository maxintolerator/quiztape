import { DIFFICULTIES, type Difficulty, type SnapshotArtist } from '@quiztape/shared';
import { describe, expect, it } from 'vitest';

import { createRng } from './rng';
import { RANK_QUESTION_MAX_RANK, generateSideAQuestions } from './side-a';
import { engineStats } from './stats';
import type { GeneratedQuestion, GeneratorContext } from './types';

const artist = (i: number): SnapshotArtist => ({
  key: `a${i}`,
  name: `Artist ${i}`,
  plays: 1_000 - i * 10,
  firstPlayedAt: 1_500_000_000 + i * 86_400 * 60,
  lastPlayedAt: 1_700_000_000,
  distinctTracks: 5,
  distinctAlbums: 2,
  mbidHint: null,
  topTracks: [],
  topAlbums: [],
  playedTrackKeys: [],
});

/** 60 artists with 410 to 1,000 plays, so every difficulty tier has anchors ranked well past the cut-off. */
const stats = engineStats({
  version: 1,
  scrobbleCount: 50_000,
  artistCount: 60,
  oldestPlayedAt: 1_500_000_000,
  newestPlayedAt: 1_700_000_000,
  artists: Array.from({ length: 60 }, (_, i) => artist(i)),
  years: [],
});

async function rankQuestions(difficulty: Difficulty): Promise<GeneratedQuestion[]> {
  const found: GeneratedQuestion[] = [];
  for (let seed = 1; seed <= 40; seed++) {
    const ctx: GeneratorContext = { db: null as never, userId: 'u', stats, rng: createRng(seed), recentFingerprints: new Set(), usedArtistKeys: new Set() };
    const questions = await generateSideAQuestions(ctx, { difficulty, count: 10 });
    found.push(...questions.filter((q) => q.category === 'stats_artist_rank'));
  }
  return found;
}

describe('rank questions', () => {
  it(`only ask about artists in the top ${RANK_QUESTION_MAX_RANK}, whatever the difficulty`, async () => {
    for (const difficulty of DIFFICULTIES) {
      for (const question of await rankQuestions(difficulty)) expect(question.numericAnswer).toBeLessThanOrEqual(RANK_QUESTION_MAX_RANK);
    }
  });

  it('still come up, with one place of slack in the top 10 and three below it', async () => {
    const asked = [...(await rankQuestions('easy')), ...(await rankQuestions('medium'))];
    const top10 = asked.filter((q) => q.numericAnswer! <= 10);
    const below = asked.filter((q) => q.numericAnswer! > 10);
    expect(top10.length).toBeGreaterThan(0);
    expect(below.length).toBeGreaterThan(0);
    expect(top10.every((q) => q.numericTolerance === 1)).toBe(true);
    expect(below.every((q) => q.numericTolerance === 3)).toBe(true);
  });
});
