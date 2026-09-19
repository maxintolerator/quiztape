# Quiztape — product brief

> Source of truth for what we are building. Written 2026-09-19. Do not edit casually; append decisions to `docs/DECISIONS.md` instead.

## What we're building

**Quiztape** is a public web and mobile app that turns anyone's Last.fm listening history into a personalized music quiz. A user connects their Last.fm account and the app generates quiz rounds mixing two things: recall of their own listening stats, and general trivia about the artists in their charts.

Tagline: **"Side A: stats. Side B: trivia."**

The cassette is the core metaphor and it maps onto the product:
- **Side A** = questions about the user's own stats (ranks, top tracks, discovery order, play-count head to heads).
- **Side B** = trivia about the bands in their library (discography order, release years, "which album contains this song", openers and closers, cross artist connections, song durations).
- **Full Mixtape** = a mixed round drawing from both sides.
- **Bracket** = a single elimination tournament seeded from the user's top artists, plus "which did you play more" duels.

## Who it's for

Public. Any Last.fm user connects their account and gets rounds generated from their own data. Design for a stranger's library, not one seeded dataset.

**Last.fm login is required to play. There is no anonymous or guest mode.** The Connect Last.fm step is the front door: no account, no rounds. Everything downstream assumes an authenticated user with synced scrobbles.

## Tech stack (decided, do not re-litigate)

- **React Native + Expo** with **Expo Router** for one codebase across web, iOS, and Android.
- **TypeScript** throughout.
- **EAS Build** and **EAS Update** for native builds and over the air updates.
- Backend: thin API layer (start with serverless functions or a small Node service). All question generation and third party API calls happen server side, never in the client.
- Database: **Postgres** (Supabase is fine) for user records and cached data. SQLite is acceptable for the very first local prototype only.
- State: keep it simple (Zustand or React context). No heavy state library.

## Data sources

1. **Last.fm API** for the user's own data.
   - OAuth web auth flow to obtain a session key.
   - Pull full scrobble history via `user.getRecentTracks` (paginated), plus `user.getTopArtists`, `getTopAlbums`, `getTopTracks`.
   - Cache every user's scrobbles in Postgres, one row per scrobble, so stats are computed by query, not by re-hitting the API. Respect the ~5 requests per second limit and backfill history in a background job.

2. **MusicBrainz** for trivia facts. This is the single most important reliability decision.
   - Do NOT generate trivia facts from an LLM's memory. Facts hallucinate. Use MusicBrainz as the source of truth: release dates (via release groups), band membership and side projects (via artist relationships), and album track listings.
   - Wikidata fills gaps MusicBrainz lacks.
   - Cache all fetched facts in Postgres. Respect MusicBrainz's 1 request per second limit with a queue.

3. **Claude API** (optional, garnish only) for two narrow jobs: rephrasing templated questions into natural language, and grading free text answers when fuzzy matching is ambiguous. Never for retrieving facts.

## Question generation engine

Think of it as: Side A questions are pure functions over the user's scrobble table. Side B questions are a join between the user's artists and the cached MusicBrainz facts. A thin template layer turns each into a question plus an answer plus a difficulty score.

Supported categories:
- Stats: artist rank, top track for an artist, top album, discovery order (first scrobble date), year chart toppers, play-count head to heads.
- Discography: order N albums by release year, release year of a named album.
- Titles: which album contains a given track, album opener, album closer.
- Cross artist: shared members, side projects, band a person left or joined (straight from MusicBrainz relationships).
- Durations: runtime of a named track (within a tolerance band).
- Optional toggles, default off: geography (origin), producer, and label. Leave these switchable per user; do not hardcode them into the default mix.

**Difficulty** is driven by play-count rank: top 10 = easy, 11 to 50 = medium, 50 to 500 = hard, below 50 plays = deep cut. Let the user pick a difficulty and weight question selection accordingly.

**Grading**: numeric stats use a tolerance band; names and titles use fuzzy match (Levenshtein or similar) so near misses like a scrambled spelling still count; ambiguous free text falls back to the Claude API grader. Always show the correct answer after each question.

## Core screens and flow

1. Connect Last.fm (OAuth). Show a friendly first sync progress state while history backfills.
2. Home: pick a mode (Side A, Side B, Full Mixtape, Bracket), pick difficulty, pick round length.
3. Round play: one question at a time, a timer, immediate correct or wrong feedback, running score.
4. Results: score, a per-question recap table, and a shareable results card.
5. Bracket: interactive single elimination tournament seeded from the user's top artists, tap to advance a pick.
6. Leaderboard and challenge a friend (later phase).

## Brand and visual identity

Direction: **neon retro cassette, 80s and 90s, but sleek and modern**, not kitschy. Reference synthwave and VHS, executed with restraint.

- Palette: deep near black base, neon magenta and cyan as the two primary accents (they double as Side A and Side B colors), warm tape cream and chrome as neutrals.
- Type: a bold condensed display face for headers, a clean monospace for data and labels, and a marker or handwritten face for the cassette label question cards.
- Signature elements:
  - Question cards styled as a handwritten cassette J card label.
  - The Side A / Side B switch animates like physically flipping a tape.
  - Tape reels spin as the question timer; streaks visualize as tape spooling.
  - The bracket renders as a tracklist.
  - Subtle VHS scanline texture, respected under prefers reduced motion.
- Quality floor: responsive down to mobile, visible keyboard focus, reduced motion honored.

## Build order

Build cross platform from day one. The Expo Router app targets web, iOS, and Android from the first commit, one codebase, no separate native phase bolted on later. Develop and test primarily on the web target for speed, but keep iOS and Android building in parallel the whole way so nothing web only creeps in. Every feature below ships to all three platforms as it lands, verified on web and smoke tested on a native simulator before moving on.

1. Scaffold the Expo Router app targeting web, iOS, and Android together, plus the backend and Postgres schema. Stub the Last.fm and MusicBrainz clients with the rate limiters in place.
2. Last.fm OAuth and scrobble backfill into Postgres.
3. Side A engine and one playable stats round with the cassette UI.
4. MusicBrainz ingestion and the Side B engine.
5. Full Mixtape mode, scoring, results card.
6. Bracket mode.
7. EAS build and submit pipeline for the iOS App Store and Google Play (native builds already run from day one; this step is store release, not first compile).
8. Leaderboards, challenge a friend, share cards.

## Guardrails

- No secrets in the client. All API keys and the Last.fm secret stay server side.
- Cache aggressively; never re-fetch what Postgres already has.
- Handle the empty and error states as first class (new account with thin history, API down, artist not found in MusicBrainz).
- Write it so a stranger's library works on day one, not just one test account.
- Keep the codebase truly cross platform. No web only APIs without a native equivalent, and flag any place a feature would diverge across web, iOS, and Android before writing it.
