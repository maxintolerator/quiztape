import { sql } from 'drizzle-orm';
import { timestamp } from 'drizzle-orm/pg-core';

/** `timestamptz NOT NULL DEFAULT now()` */
export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
export const updatedAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
export const tstz = () => timestamp({ withTimezone: true });

export const emptyJsonObject = sql`'{}'::jsonb`;
export const emptyJsonArray = sql`'[]'::jsonb`;
export const emptyTextArray = sql`'{}'::text[]`;
