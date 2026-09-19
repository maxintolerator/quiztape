# Decisions

Append-only log of choices not obvious from the code. Newest last.

## 2026-09-19 Foundation

- **npm workspaces, not pnpm/yarn/bun.** Only npm and yarn 1 exist on the dev machine; Expo's monorepo support targets npm/yarn workspaces and needs no Metro config with SDK 57.
- **Expo SDK 57 default template, trimmed.** The template's native tabs, glass effects, SF Symbols and demo components were removed: they are iOS-first and do not fit a dark-only cassette UI. Kept: Expo Router with `src/app`, React Compiler, typed routes.
- **Separate Hono API instead of Expo Router API routes.** The backfill job runs for minutes per user and needs a long-lived process or a queue; request-scoped API routes are the wrong shape. Hono runs as Node locally and deploys to serverless adapters unchanged.
- **Drizzle ORM + postgres.js.** Schema as TypeScript, SQL migrations checked in, works against Supabase's pooler with `prepare: false`.
- **PGlite for schema tests.** Postgres compiled to WASM; migrations are applied in-process in vitest so the schema is exercised in CI with nothing installed.
- **TypeScript `module: Preserve` / `moduleResolution: Bundler` everywhere.** One resolution mode that Metro, tsx and vitest all agree on, with extensionless imports. Packages export `.ts` source; no build step in the monorepo.
- **Rate limiting lives in the clients, one limiter per upstream per process**, with a priority queue so interactive lookups jump ahead of background backfill, and `pause()` so a 429/503 holds every queued request, not just the one that failed.
- **Bundle identifiers** `com.quiztape.app` are placeholders; change before the first EAS build.
- **`web.output: "single"` (SPA), not `static`.** Every screen sits behind Last.fm login and round/bracket routes are dynamic, so per-route prerendering buys nothing and would require `generateStaticParams`. Public share pages with Open Graph tags will be served by the API instead.
- **Node 22.13 or newer.** Expo SDK 57 sets that floor and vitest 5 / vite 7 need `require(esm)` (Node 22.12+). The dev machine currently runs 22.3, so vitest is pinned to 3.x with vite 6 until Node is upgraded; the pin is removable afterwards.
- **Last.fm auth callback lands on the API, not the app.** The API exchanges the 60-minute single-use token for the session key (needs the secret and an MD5 signature) and then redirects to the platform's return URL: the web origin, or `quiztape://auth/callback` on native via `openAuthSessionAsync`. Expo Go cannot receive custom-scheme redirects, so native auth testing needs a development build.
- **Wikidata is reached through MusicBrainz first.** `inc=url-rels` carries a `wikidata` relation for artists, release groups, works and labels (never recordings). Only unresolved entities go to a single-worker Wikidata client (GraphQL/SPARQL VALUES batches of 50) behind a strict limiter.
- **Relationship types are matched by `type-id` UUID**, not by name, and `subgroup` is treated as undirected because the data stores it both ways.
- **Last.fm MBIDs are hints, not keys.** Artist MBIDs are verified with a MusicBrainz lookup (fallback: name search with disambiguation); album and track MBIDs from Last.fm are unreliable and never used for joins.
- **Last.fm 100 MB storage cap is a product decision for the owner.** See `docs/COMPLIANCE.md`.
- **Schema synthesised by hand from three agent designs, not by the judge panel.** The design workflow produced three complete schemas (integrity-first, performance-first, coverage-first) but its judging stage stalled under capacity limits. The final schema takes inline names plus normalised keys on the scrobble row (integrity design), rebuilt per-user rollups including year charts (performance design), and the raw-payload MusicBrainz cache, canonical-release tracklists and stored questions with anchors and fingerprints (coverage design). Challenges and leaderboards are deferred; `rounds` already carries what they need.
- **Difficulty is computed in application code, not a generated column**, so `difficultyFor` in `@quiztape/shared` is the single source of the rule and changing it needs a rollup rebuild, not a migration.
