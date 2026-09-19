import { schema } from '@quiztape/db';
import { and, eq, isNull } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../app';
import { sha256Hex } from '../lib/crypto';

export interface AuthContext {
  userId: string;
  sessionId: string;
  user: typeof schema.users.$inferSelect;
}

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Bearer token -> app_sessions lookup. 401 on anything short of a live session. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return c.json({ error: 'unauthorized' }, 401);
  const token = header.slice(7).trim();
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const { db, now } = c.get('services');
  const [row] = await db
    .select({ session: schema.appSessions, user: schema.users })
    .from(schema.appSessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.appSessions.userId))
    .where(and(eq(schema.appSessions.tokenHash, sha256Hex(token)), isNull(schema.appSessions.revokedAt), isNull(schema.users.deletedAt)))
    .limit(1);

  const current = now();
  if (!row || row.session.expiresAt.getTime() <= current.getTime()) return c.json({ error: 'unauthorized' }, 401);

  if (!row.session.lastSeenAt || current.getTime() - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(schema.appSessions).set({ lastSeenAt: current }).where(eq(schema.appSessions.id, row.session.id));
  }

  c.set('auth', { userId: row.user.id, sessionId: row.session.id, user: row.user });
  await next();
});
