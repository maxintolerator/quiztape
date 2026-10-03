# Quiztape database schema

Postgres (Supabase-compatible), defined with Drizzle in `packages/db/src/schema`, migrations in `packages/db/drizzle`, tested against PGlite in `packages/db/src/schema.test.ts`.

Design rules:

- **No listening history.** Scrobbles and per-user stats live on the player's device (see `docs/DECISIONS.md`, 2026-10-03). The API receives a stats snapshot with each round or bracket request and stores only what it produced from it: questions, answers, bracket entrants. `rounds.stats_snapshot_at` and `brackets.stats_snapshot_at` record how fresh that snapshot was. Artists are identified by a normalised key (`lower(trim(name))`, whitespace collapsed); Last.fm MBIDs are hints and never used for joins.
- **MusicBrainz is cached by MBID.** `mb_cache_entries` keeps raw payloads (including `not_found` negative entries) so normalised rows can be re-derived without another request. Merged MBIDs land in `mb_mbid_redirects`. Relationships are matched by `type_id` UUID.
- **One canonical release per release group** carries the tracklist (`mb_tracks`), which is where openers, closers and "which album contains" come from. Release years and discography order come from `mb_release_groups.first_release_date`.
- **Wikidata is a gap filler.** `wd_entity_links` maps MBIDs to Q-items (free via MusicBrainz url-rels when available); `wd_artist_facts` holds the extracted geography/label facts for the optional toggles.
- **Everything user-owned cascades** from `users`. Cache tables are shared across users and never deleted with a user.
- **Secrets never sit in plaintext.** Last.fm session keys are stored encrypted (`lastfm_sessions.session_key_ciphertext`); app sessions and auth tokens are stored as hashes.
- **Row level security is on for every table, with no policies.** The API connects as the table owner and is unaffected; Supabase's Data API roles (`anon`, `authenticated`) get no rows. A new table needs `.enableRLS()`; the schema test fails without it.

## Tables

| Area | Table | Purpose |
| --- | --- | --- |
| Identity | `users` | One row per connected Last.fm account, keyed by lower-cased username |
| Identity | `lastfm_sessions` | Encrypted Last.fm session key, one active per user |
| Identity | `auth_flows` | One row per Connect attempt; makes token exchange single-use and idempotent |
| Identity | `app_sessions` | The app's own bearer sessions (hash only) |
| Identity | `user_settings` | Defaults and the optional geography / producer / label toggles |
| Jobs | `sync_jobs` | Durable job queue for MusicBrainz ingestion with dedupe key, priority, lease, retries |
| Resolution | `artist_resolutions` | Global Last.fm artist name to MBID mapping with confidence and manual overrides |
| MusicBrainz | `mb_cache_entries` | Raw WS/2 payloads by (entity, mbid, inc), including negative cache |
| MusicBrainz | `mb_mbid_redirects` | Merged MBIDs to canonical MBIDs |
| MusicBrainz | `mb_artists` | Artist facts, type, area, life span, Wikidata id, per-facet fetch timestamps |
| MusicBrainz | `mb_artist_relations` | Membership, side projects, renames: canonical orientation, one row per stint |
| MusicBrainz | `mb_release_groups` | Albums: types, first release date, studio-album flag, canonical release |
| MusicBrainz | `mb_releases` | Editions; exactly one canonical per group |
| MusicBrainz | `mb_recordings` | Recording title and length |
| MusicBrainz | `mb_tracks` | Canonical tracklists with positions, opener/closer flags |
| MusicBrainz | `mb_labels`, `mb_release_labels` | Label credits for the optional label toggle |
| MusicBrainz | `mb_recording_credits` | Producer / engineer credits for the optional producer toggle |
| MusicBrainz | `mb_search_cache` | Name search results by normalised query with TTL |
| Wikidata | `wd_entity_links` | MBID to Q-item resolution state |
| Wikidata | `wd_entities` | Raw claims per item |
| Wikidata | `wd_artist_facts` | Extracted origin, country, inception, genres, labels |
| Quiz | `rounds` | A generated round: mode, difficulty, score, share slug |
| Quiz | `round_questions` | Stored questions with payload, correct answer, anchors, fingerprint |
| Quiz | `answers` | One answer per question with grading method and score |
| Quiz | `llm_calls` | Every Claude call (rephrase / grade) for cost tracking and caching |
| Bracket | `brackets` | Tournament state and duel tally |
| Bracket | `bracket_entrants` | Seeded artists |
| Bracket | `bracket_matches` | Matches, picks, duel answers, feed-forward links |

Later phases add `challenges` and `leaderboard_entries`; `rounds` already carries the score, mode, difficulty and share slug they need.
