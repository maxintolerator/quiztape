import { schema } from '@quiztape/db';
import type { RecentTrack } from '@quiztape/lastfm';
import { type BracketStateDto, type DuelResultDto, roundName, seedingOrder } from '@quiztape/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { createFakeLastfm, track } from '../fake-lastfm';
import { handlers } from '../jobs/handlers';
import { enqueueJob } from '../jobs/queue';
import { JobRunner } from '../jobs/runner';
import { sha256Hex } from '../lib/crypto';
import { ensureUserRows } from '../lib/users';
import type { Services } from '../services';
import { createTestServices } from '../testing';

const ARTISTS = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10'];

function buildHistory() {
  const rows: RecentTrack[] = [];
  let t = 1_500_000_000;
  ARTISTS.forEach((artist, i) => {
    for (let p = 0; p < 200 - i * 10; p++) {
      t += 600;
      rows.push(track(t, artist, `${artist} song ${p % 4}`, `${artist} album`));
    }
  });
  return rows;
}

let services: Services;
let app: ReturnType<typeof createApp>;
let token: string;

beforeAll(async () => {
  const lastfm = createFakeLastfm({ history: buildHistory(), perPage: 200 });
  services = await createTestServices({ fetch: lastfm.fetch });
  app = createApp(services);
  const [user] = await services.db.insert(schema.users).values({ lastfmUsername: 'someone', lastfmUsernameKey: 'someone' }).returning();
  await ensureUserRows(services, user!.id);
  token = 'test-token-' + 'z'.repeat(30);
  await services.db.insert(schema.appSessions).values({ userId: user!.id, tokenHash: sha256Hex(token), platform: 'web', expiresAt: new Date(Date.now() + 86_400_000) });
  await enqueueJob(services, { kind: 'backfill', userId: user!.id, dedupeKey: `backfill:${user!.id}` });
  await new JobRunner(services, handlers, { workerId: 'test' }).drain();
}, 180_000);

afterAll(async () => {
  await services?.close();
});

const authed = (init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' } });

describe('seeding helpers', () => {
  it('orders seeds so 1 and 2 meet only in the final', () => {
    expect(seedingOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedingOrder(16).slice(0, 4)).toEqual([1, 16, 8, 9]);
    expect(roundName(1, 4)).toBe('Round of 16');
    expect(roundName(3, 4)).toBe('Semifinals');
    expect(roundName(4, 4)).toBe('Final');
  });
});

describe('bracket', () => {
  it('falls back to the largest size the library supports and plays through duels and picks', async () => {
    const created = await app.request('/v1/brackets', authed({ method: 'POST', body: JSON.stringify({ size: 16 }) }));
    expect(created.status).toBe(201);
    let state = (await created.json()) as BracketStateDto;
    expect(state.bracket.size).toBe(8); // only 10 artists have 50+ plays
    expect(state.bracket.roundCount).toBe(3);
    expect(state.entrants.map((e) => e.artistName)).toEqual(ARTISTS.slice(0, 8));
    expect(state.entrants.every((e) => e.playCount === null)).toBe(true);
    expect(state.matches).toHaveLength(7);
    expect(state.current).toMatchObject({ roundNo: 1, matchNo: 0, seedA: 1, seedB: 8 });

    // Picking before the duel is refused.
    const early = await app.request(`/v1/brackets/${state.bracket.id}/matches/${state.current!.id}/pick`, authed({ method: 'POST', body: JSON.stringify({ seed: 1 }) }));
    expect(early.status).toBe(409);

    let duelsCorrect = 0;
    let played = 0;
    while (state.current) {
      const match = state.current;
      // Guess the higher seed (always more played here), then advance the lower seed to make it interesting.
      const guess = Math.min(match.seedA!, match.seedB!);
      const duelRes = await app.request(`/v1/brackets/${state.bracket.id}/matches/${match.id}/duel`, authed({ method: 'POST', body: JSON.stringify({ seed: guess }) }));
      expect(duelRes.status).toBe(200);
      const duel = (await duelRes.json()) as DuelResultDto;
      expect(duel.correct).toBe(true);
      expect(duel.morePlayedSeed).toBe(guess);
      expect(duel.playsA).toBeGreaterThan(0);
      duelsCorrect += duel.correct ? 1 : 0;
      const winner = Math.max(match.seedA!, match.seedB!);
      const pickRes = await app.request(`/v1/brackets/${state.bracket.id}/matches/${match.id}/pick`, authed({ method: 'POST', body: JSON.stringify({ seed: winner }) }));
      expect(pickRes.status).toBe(200);
      state = (await pickRes.json()) as BracketStateDto;
      played++;
    }
    expect(played).toBe(7);
    expect(state.bracket).toMatchObject({ status: 'completed', duelsTotal: 7, duelsCorrect });
    expect(state.bracket.championSeed).toBe(8); // the underdog advanced every time
    expect(state.entrants.find((e) => e.seed === 8)!.eliminatedInRound).toBeNull();
    expect(state.entrants.find((e) => e.seed === 1)!.eliminatedInRound).toBe(1);
    expect(state.entrants.every((e) => e.playCount !== null)).toBe(true);
    expect(state.matches.find((m) => m.roundNo === 3)!).toMatchObject({ seedA: 8, winnerSeed: 8 });

    const again = await app.request(`/v1/brackets/${state.bracket.id}/matches/${state.matches[0]!.id}/duel`, authed({ method: 'POST', body: JSON.stringify({ seed: 1 }) }));
    expect(again.status).toBe(409);
  });
});
