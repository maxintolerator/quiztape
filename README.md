# Quiztape

**Side A: stats. Side B: trivia.**

Connect your Last.fm account and Quiztape cuts a quiz from your own listening history: Side A asks about your stats, Side B asks trivia about the bands in your library, sourced from MusicBrainz. One codebase for web, iOS and Android.

See `docs/BRIEF.md` for the product brief, `CLAUDE.md` for the working rules, `docs/SCHEMA.md` for the database.

## Quick start

```
nvm use            # Node 22
npm install
cp .env.example .env   # fill in DATABASE_URL and Last.fm keys (server side only)
npm run web        # http://localhost:8081
npm run api        # http://localhost:8787/health
npm test
npm run check:platforms   # proves the iOS and Android bundles compile too
```
