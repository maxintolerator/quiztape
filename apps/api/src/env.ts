import { z } from 'zod';

/**
 * Server-side configuration. Parsed lazily so routes that need nothing (health)
 * work in tests and CI without a full .env. Secrets never leave this process.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  DATABASE_URL: z.url(),
  LASTFM_API_KEY: z.string().min(1, 'LASTFM_API_KEY is required'),
  LASTFM_API_SECRET: z.string().min(1, 'LASTFM_API_SECRET is required'),
  LASTFM_CALLBACK_URL: z.url(),
  MUSICBRAINZ_APP_NAME: z.string().min(1).default('Quiztape'),
  MUSICBRAINZ_APP_VERSION: z.string().min(1).default('0.1.0'),
  MUSICBRAINZ_CONTACT: z.string().min(3, 'MusicBrainz requires a contact email or URL in the User-Agent'),
  ANTHROPIC_API_KEY: z.string().optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:8081')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  if (cached) return cached;
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid server environment:\n${issues}`);
  }
  cached = result.data;
  return cached;
}

/** Test hook. */
export function resetEnvCache(): void {
  cached = undefined;
}
