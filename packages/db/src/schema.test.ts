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

  it('enable row level security on every table, so the Supabase Data API roles get nothing', async () => {
    const result = await handle.pglite.execute<{ relname: string }>(
      sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(result.rows.map((row) => row.relname), 'tables declared without .enableRLS()').toEqual([]);
  });
});

describe('core invariants', () => {
  it('keeps no listening history: the library lives on the player\'s device', async () => {
    const result = await handle.pglite.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' and (table_name = 'scrobbles' or table_name like 'user\\_%\\_stats' or table_name = 'user_sync_state')`,
    );
    expect(result.rows).toEqual([]);
  });

  it('deleting a user cascades to settings, rounds and questions', async () => {
    const [user] = await handle.db
      .insert(schema.users)
      .values({ lastfmUsername: 'Gone', lastfmUsernameKey: 'gone' })
      .returning();
    await handle.db.insert(schema.userSettings).values({ userId: user!.id });
    const [round] = await handle.db
      .insert(schema.rounds)
      .values({ userId: user!.id, mode: 'side_a', difficulty: 'easy', requestedLength: 5, seed: 1, generatorVersion: 'test', timerSeconds: 20 })
      .returning();
    await handle.db.insert(schema.roundQuestions).values({
      roundId: round!.id,
      userId: user!.id,
      position: 0,
      category: 'stats_artist_rank',
      difficulty: 'easy',
      answerFormat: 'numeric',
      templateId: 'stats_artist_rank.v1',
      prompt: 'Where does X sit?',
      correctAnswer: { value: 1 },
      correctDisplay: '#1',
      fingerprint: 'f',
      timeLimitSeconds: 20,
    });
    await handle.db.delete(schema.users).where(eq(schema.users.id, user!.id));
    const [settings] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(schema.userSettings).where(eq(schema.userSettings.userId, user!.id));
    const [rounds] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(schema.rounds).where(eq(schema.rounds.userId, user!.id));
    const [questions] = await handle.db.select({ n: sql<number>`count(*)::int` }).from(schema.roundQuestions).where(eq(schema.roundQuestions.userId, user!.id));
    expect([settings?.n, rounds?.n, questions?.n]).toEqual([0, 0, 0]);
  });
});
