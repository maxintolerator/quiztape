# Quiztape

**Side A: stats. Side B: trivia.**

Connect your Last.fm account and Quiztape cuts a quiz from your own listening history: Side A asks about your stats, Side B asks trivia about the bands in your library, sourced from MusicBrainz. One codebase for web, iOS and Android.

See `docs/BRIEF.md` for the product brief, `CLAUDE.md` for the working rules, `docs/SCHEMA.md` for the database, `docs/COMPLIANCE.md` for the third-party terms that shape the product.

## Run it locally

Prerequisites: Node 22.13+, a Postgres URL (a free Supabase project works), a Last.fm API account.

1. Create a Last.fm API account at https://www.last.fm/api/account/create. Callback URL: `http://localhost:8787/v1/auth/lastfm/callback`.
2. Copy `.env.example` to `.env` at the repo root and fill in `DATABASE_URL`, `LASTFM_API_KEY`, `LASTFM_API_SECRET`, `MUSICBRAINZ_CONTACT` and a random `SESSION_SECRET` (32+ characters).
3. Install and migrate:

   ```
   npm install
   npm run db:migrate
   npm run db:check     # confirms the tables exist before you start the API
   ```

4. Start the API (with the background job runner) and the web app in two terminals:

   ```
   npm run api      # http://localhost:8787/health
   npm run web      # http://localhost:8081
   ```

5. Open http://localhost:8081, press **Connect Last.fm**, approve, and watch the first sync spool in. When it reads "library synced", pick Side A, a difficulty and a length, and press play.

Native: `npm run ios` / `npm run android` need Xcode or Android Studio and a development build (Expo Go cannot receive the sign-in redirect). `npm run check:platforms` proves the iOS and Android bundles compile without either.

## Deploy

See `docs/DEPLOY.md` for the quiztape.com setup: API container on Fly.io, static web on Cloudflare Pages, Postgres on Supabase.

## Verify

```
npm run typecheck
npm test
npm run check:platforms
npm run doctor
```
