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

## 2026-09-19 Step 3: first playable round (Side A)

- **Question generation is server-side pure functions over the rollups**, never over the raw scrobble table, and never over Last.fm live. Each generator refuses ambiguous data (ties, too few tracks) and the builder moves on, so thin libraries get fewer, sound questions rather than bad ones. Fewer than 8 ranked artists is a first-class "library too thin" state.
- **Answer formats follow the brief's grading rules**: numeric with a tolerance band that widens with rank (1 place in the top 10, 3 to 50, 10 to 200, then 10 %), free text with fuzzy matching (normalised Levenshtein similarity of 0.82 or better counts; 0.6 to 0.82 is recorded as ambiguous for the future Claude grader), multiple choice for head-to-head and discovery order. The correct answer is always returned after grading and never before.
- **Scoring**: 100 points per correct answer plus up to 50 for speed, decaying linearly over the timer. Streaks are tracked for the UI; no multiplier yet.
- **Rounds are stored up front** (all questions generated at creation, seeded PRNG recorded) so a round can be resumed, recapped and later replayed by a challenged friend against the same question set. Fingerprints stop a question repeating within 30 days.
- **Fonts**: Anton (display), Space Mono (data), Permanent Marker (J-card handwriting), loaded with `useFonts` from `@expo-google-fonts/*` so web, iOS and Android ship identical files. The splash screen holds until fonts and the session are ready.
- **Timer runs client-side** for feel; the server trusts `responseMs` only for the speed bonus, never for correctness, and clamps it.

## 2026-09-19 Step 4: MusicBrainz ingestion and Side B

- **Ingestion is a per-user job, most played first.** `mb_ingest` walks the user's eligible artists (50+ plays) by rank so Side B unlocks after the first eight artists, not after the whole library. Every step is idempotent and reads `mb_cache_entries` first, so retries and other users' overlapping libraries cost no requests.
- **Resolution order: Last.fm hint, then name search.** The hint MBID is verified by lookup and name match before it is trusted; searches accept only an exact-name hit that clearly outranks the runner-up. Ties are stored as ambiguous and retried after 30 days rather than guessed.
- **Studio discography = primary type Album, no secondary types, sole credit, at least one official release.** One canonical release per group is scored by date match, single medium, common format and track count, home market, and the absence of deluxe or reissue wording; only that release's tracklist is fetched.
- **Members' other bands come from the members' own lookups**, capped at eight per group, which is what makes shared-member and side-project questions possible without a graph crawl.
- **Side B answer formats**: albums in release order use a tap-to-order control; track runtime accepts m:ss with a tolerance of at least 15 seconds; openers, closers and "which album" are multiple choice built from the same artist's own albums or the same album's own tracks, so distractors are plausible.
- **Mixtape alternates sides**, half and half, starting on a random side.
- **Optional toggles (geography, producer, label) still generate nothing**; they need the Wikidata enrichment job, which is the next piece of Side B.

## 2026-09-19 Step 6: Bracket, and ingestion split per artist

- **One ingestion job per artist, prioritised by rank**, instead of one long job per user. MusicBrainz allows one request per second per IP, so throughput scales with machines (each has its own address) rather than with worker concurrency, and a new user's top artists jump ahead of an old user's deep cuts. Artist jobs are deduplicated by name across users; the per-user job only fans out and skips artists that are already fresh.
- **Cheaper deep cuts.** Members' own lookups (for side projects and shared members) are fetched only for an artist ranked 150 or better in the requesting user's library; every eligible artist still gets discography and tracklists.
- **Bracket = two beats per match.** A duel (which did you play more? scored against the rollups) followed by a pick (who advances, the player's taste). The champion is the player's favourite; the duel score is the recall. Play counts are hidden until the bracket is complete so the duel means something. Seeding uses the standard order (1 meets 16 first, 1 and 2 only in the final); the size falls back to the largest the library supports, minimum 8.

## 2026-10-03 Row level security

- **RLS enabled on every table, zero policies.** Supabase exposes the `public` schema through its Data API to the `anon` and `authenticated` roles, and flagged all 35 tables as readable and writable by anyone holding the project's anon key. Quiztape never uses the Data API: the API connects with postgres.js as `postgres`, which owns the tables and bypasses RLS. RLS with no policies therefore denies the Data API roles everything and changes nothing for the app. Tables declare it with `.enableRLS()`; `schema.test.ts` fails if one is missed.

## 2026-10-03 The listening history moves to the device

Supersedes the brief's "cache every user's scrobbles in Postgres, one row per scrobble" and "all third party API calls happen server side" for the Last.fm history. Measured on the one real account in the database (153,779 scrobbles): 78 MB of scrobble rows, 22 MB of rollups, 169 MB in total. Supabase's free plan (500 MB) would have held about three such players, Last.fm's terms cap stored Last.fm data at 100 MB, and every player's import queued behind one shared 5-requests-per-second allowance on the server.

- **The device downloads and keeps the history.** `user.getRecentTracks` needs only the API key, which `/v1/me` hands to signed-in clients; the secret never leaves the server. Each device spends its own Last.fm allowance (4 pages per 0.9 s), checkpoints after every batch and resumes after a closed tab. Storage is IndexedDB on web and SQLite (`expo-sqlite/kv-store`) on native, behind one four-function key-value contract; the import, top-up and snapshot logic above it is in `@quiztape/shared` and tested there.
- **The server sees a snapshot, per request, and stores none of it.** Round and bracket requests carry a `StatsSnapshot` (eligible artists with play counts, top two tracks and albums, first-play dates, yearly top two; about 265 KB for the account above). The engine reads it instead of rollup tables. Keys, ranks and difficulty are re-derived on the server; the snapshot is otherwise taken at face value, so a player can lie to their own quiz. That stops being acceptable when leaderboards or challenges arrive (step 8) and needs revisiting then.
- **Band facts are fetched for each player's 50 most played artists** (`TRIVIA_ARTIST_CAP`), announced by the device through `POST /v1/me/library`, at most once per ten minutes per user. Artist keys for the shared cache are always computed on the server from the name: a client-chosen key could attach one artist's name to another's facts for everybody. Side B still uses any of the player's artists that happen to be cached already.
- **Tables removed:** `scrobbles`, the four `user_*_stats` rollups and `user_sync_state` (migration 0003). The `sync_job_kind` enum keeps its history values so old job rows stay readable; only `mb_ingest` is queued now.
- **A history file** (download and load, web only for now) lets a player move their library between browsers without downloading it again.
- **Side effect:** the old rollup rebuild read the scrobble table once per statement inside one transaction, so plays inserted mid-rebuild were counted in the track and album rollups but not the artist rollup (159 rows on the real account). One pass over the device's copy cannot do that.
