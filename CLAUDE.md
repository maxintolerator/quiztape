# Quiztape

Side A: stats. Side B: trivia. A Last.fm-powered music quiz shipped as one Expo Router codebase to web, iOS and Android, with a thin Node API and Postgres behind it. The listening history lives on the player's device; Postgres holds accounts, rounds and the shared MusicBrainz cache.

The product brief is the source of truth: `docs/BRIEF.md`, as amended by `docs/DECISIONS.md` (the 2026-10-03 entry moved the history out of Postgres and onto the device; the 2026-10-05 entry replaced Last.fm login with typing a username, removed the bracket and limited rank questions to the top 20). The schema is documented in `docs/SCHEMA.md`. Platform divergences are logged in `docs/PLATFORMS.md`. Third-party terms that constrain the product are in `docs/COMPLIANCE.md`. Do not re-litigate the stack.

Requires Node 22.13 or newer (Expo SDK 57 floor).

## Layout

```
apps/client      Expo Router app (web + iOS + Android). No secrets. One third-party call: it reads the player's own history from Last.fm and keeps it on the device.
apps/api         Hono API + in-process job runner. Username sign-in (checked with Last.fm user.getInfo), all MusicBrainz/Claude calls and the question engine (src/engine) live here. Stores no listening history.
packages/shared  Types and constants shared by client and API, plus the device-side library: history download, local store, stats snapshot. Dependency-free, platform-neutral.
packages/db      Drizzle schema, migrations, Postgres client (Supabase-compatible).
packages/ratelimit  Token-bucket limiter + retry/backoff used by every upstream client.
packages/lastfm  Server-side Last.fm client (signing is supported but unused: sign-in needs no Last.fm login). ~5 req/s.
packages/musicbrainz  MusicBrainz WS/2 client. Strict 1 req/s, mandatory User-Agent. The only source of trivia facts.
docs/            Brief, schema, decisions, platform log.
```

npm workspaces. Packages export TypeScript source directly (`exports` → `src/index.ts`); Metro, tsx and vitest all consume it without a build step.

## Commands

```
npm run web              # Expo dev server, web target (primary dev loop)
npm run ios / android    # native dev (needs Xcode / Android Studio; see docs/PLATFORMS.md)
npm run api              # Hono API with tsx watch on :8787
npm run typecheck        # tsc across every workspace (client first regenerates Expo Router route types)
npm test                 # vitest across packages and the API
npm run check:platforms  # expo export for web+ios+android: catches web-only code without a simulator
npm run doctor           # expo-doctor
npm run db:generate      # drizzle-kit generate migrations from packages/db/src/schema
npm run db:migrate       # apply migrations to DATABASE_URL (DATABASE_MIGRATE_URL if set)
npm run db:check         # show target database, tables, applied vs checked-in migrations
npm run render-docs -w @quiztape/db   # regenerate docs/SCHEMA.md after a schema change
```

## Rules that are not negotiable

- **Cross-platform from the first commit.** No web-only API without a native equivalent. Platform-specific files (`*.web.tsx`, `*.native.tsx`) are the escape hatch; every divergence gets a line in `docs/PLATFORMS.md` before it is written. `npm run check:platforms` must pass before a feature is done.
- **No secrets in the client.** Only `EXPO_PUBLIC_*` variables reach the bundle; nothing in `apps/client` imports `@quiztape/lastfm`, `@quiztape/musicbrainz` or `@quiztape/db`. The Last.fm API key (an identifier, not the secret) is handed to signed-in clients by `/v1/me`. Players sign in by typing their Last.fm username; there is no Last.fm OAuth.
- **The listening history stays on the device.** The client downloads it from Last.fm (`@quiztape/shared` `importLibrary`), stores it locally and sends a stats snapshot with each round request. The API never persists scrobbles or per-user stats, and derives keys, ranks and difficulty from the snapshot itself rather than trusting them.
- **MusicBrainz is the only source of trivia facts.** Never generate facts from an LLM. Claude is garnish: rephrasing and ambiguous-answer grading only.
- **Cache aggressively.** The device fetches only plays newer than what it holds. MusicBrainz facts are cached in Postgres by MBID with a negative cache for not-found, shared by all players, and fetched for each player's 50 most played artists.
- **Empty and error states are first class.** Thin libraries, upstream outages and artists missing from MusicBrainz are normal paths, not exceptions.
- **Rate limits are enforced in the clients**, one shared limiter per upstream per process. Never call `fetch` on an upstream directly. The device-side history download paces itself the same way (`IMPORT_BATCH_MIN_MS`).

## Conventions

- TypeScript strict everywhere, including `exactOptionalPropertyTypes` (optional fields are declared `T | undefined` when callers may pass undefined).
- Tests live next to code as `*.test.ts` and run under vitest with fake timers for anything time-based. Client logic worth testing goes in `packages/shared` (vitest does not cover `apps/client`).
- snake_case in Postgres, camelCase in TypeScript; Drizzle's `casing: 'snake_case'` does the mapping.
- Never interpolate a JavaScript `Date` into a raw `sql\`...\`` fragment; pass `date.toISOString()` with a `::timestamptz` cast. Typed column writes are fine. PGlite tolerates the Date, the postgres.js driver throws, so this only shows up against a real database.
- Design tokens live in `apps/client/src/theme/tokens.ts`. Magenta is Side A, cyan is Side B.
- Keep state simple: Zustand or React context. No heavy state library.

## Verifying work

Web: `npm run web` and open http://localhost:8081. Native: a simulator when available; otherwise `npm run check:platforms` proves the iOS and Android bundles compile, and Expo Go on a physical device runs them. See `docs/PLATFORMS.md` for this machine's toolchain status.
