import { eq, getTableName, is, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from './schema';
import { createTestDb } from './test-db';

let handle: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  handle = await createTestDb();
}, 120_000);

afterAll(async () => {
  await handle?.close();
});

describe('schema migrations', () => {
  it('apply cleanly to a fresh Postgres and create every table the schema declares', async () => {
    const result = await handle.pglite.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const created = new Set(result.rows.map((row) => row.table_name));
    const declared = (Object.values(schema) as unknown[])
      .filter((value): value is PgTable => is(value, PgTable))
      .map((table) => getTableName(table))
      .sort();
    expect(declared.length).toBeGreaterThan(20);
    for (const name of declared) expect(created, `table ${name} missing after migrations`).toContain(name);
  });
});

describe('core invariants', () => {
  it('scrobble backfill is idempotent: re-inserting the same plays adds no rows', async () => {
    const [user] = await handle.db
      .insert(schema.users)
      .values({ lastfmUsername: 'Someone', lastfmUsernameKey: 'someone' })
      .returning();
    const rows = [
      {
        userId: user!.id,
        playedAt: new Date('2023-11-14T22:13:20Z'),
        artistName: 'Boards of Canada',
        artistKey: 'boards of canada',
        trackName: 'Roygbiv',
        trackKey: 'roygbiv',
        albumName: 'Music Has the Right to Children',
        albumKey: 'music has the right to children',
      },
      {
        userId: user!.id,
        playedAt: new Date('2023-11-14T22:17:50Z'),
        artistName: 'Boards of Canada',
        artistKey: 'boards of canada',
        trackName: 'Aquarius',
        trackKey: 'aquarius',
        albumName: null,
        albumKey: null,
      },
    ];
    await handle.db.insert(schema.scrobbles).values(rows).onConflictDoNothing();
    await handle.db.insert(schema.scrobbles).values(rows).onConflictDoNothing();
    const [count] = await handle.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.scrobbles)
      .where(eq(schema.scrobbles.userId, user!.id));
    expect(count?.n).toBe(2);
  });

  it('deleting a user cascades to scrobbles and rollups', async () => {
    const [user] = await handle.db
      .insert(schema.users)
      .values({ lastfmUsername: 'Gone', lastfmUsernameKey: 'gone' })
      .returning();
    await handle.db.insert(schema.scrobbles).values({
      userId: user!.id,
      playedAt: new Date('2020-01-01T00:00:00Z'),
      artistName: 'X',
      artistKey: 'x',
      trackName: 'Y',
      trackKey: 'y',
    });
    await handle.db.insert(schema.userArtistStats).values({
      userId: user!.id,
      artistKey: 'x',
      artistName: 'X',
      playCount: 1,
      rank: 1,
      difficulty: 'deep_cut',
      firstPlayedAt: new Date('2020-01-01T00:00:00Z'),
      lastPlayedAt: new Date('2020-01-01T00:00:00Z'),
    });
    await handle.db.delete(schema.users).where(eq(schema.users.id, user!.id));
    const [scrobbles] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(schema.scrobbles).where(eq(schema.scrobbles.userId, user!.id));
    const [stats] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(schema.userArtistStats).where(eq(schema.userArtistStats.userId, user!.id));
    expect(scrobbles?.n).toBe(0);
    expect(stats?.n).toBe(0);
  });

  it('rejects a bracket whose size is not a power of two', async () => {
    const [user] = await handle.db
      .insert(schema.users)
      .values({ lastfmUsername: 'Bracket', lastfmUsernameKey: 'bracket' })
      .returning();
    await expect(
      handle.db.insert(schema.brackets).values({ userId: user!.id, size: 6, roundCount: 3, timerSecondsIgnored: undefined } as never),
    ).rejects.toThrow();
    await handle.db.insert(schema.brackets).values({ userId: user!.id, size: 8, roundCount: 3 });
  });

  it('allows only one active Last.fm session per user', async () => {
    const [user] = await handle.db
      .insert(schema.users)
      .values({ lastfmUsername: 'Sessions', lastfmUsernameKey: 'sessions' })
      .returning();
    const key = Buffer.from('ciphertext');
    await handle.db.insert(schema.lastfmSessions).values({ userId: user!.id, sessionKeyCiphertext: key });
    await expect(handle.db.insert(schema.lastfmSessions).values({ userId: user!.id, sessionKeyCiphertext: key })).rejects.toThrow();
    await handle.db.insert(schema.lastfmSessions).values({ userId: user!.id, sessionKeyCiphertext: key, status: 'revoked' });
  });
});
