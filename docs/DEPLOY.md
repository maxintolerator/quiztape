# Deploying Quiztape to quiztape.com

Three pieces, three hosts. The API is a long-running Node process (it carries the job runner), the web app is a static single-page bundle, and Postgres already lives at Supabase.

| Piece | Host | URL |
| --- | --- | --- |
| Web app (Expo static export) | Cloudflare Pages (or Vercel / Netlify) | `https://quiztape.com`, `https://www.quiztape.com` |
| API + job runner (Docker) | Fly.io (or Railway / Render, anything that runs a container 24/7) | `https://api.quiztape.com` |
| Postgres | Supabase (existing project) | pooler on 6543 for the API, direct 5432 for migrations |

Serverless is deliberately not used for the API: the backfill runs for minutes per user and needs a process that stays up.

## 0. Before you start

- Domain `quiztape.com` at a registrar where you can edit DNS.
- Accounts: Fly.io (`brew install flyctl` or the installer from fly.io; `fly auth login`), Cloudflare (Pages), Supabase (existing).
- Fill the remaining placeholders in `packages/shared/src/legal.ts` (hosting provider regions, your US state for governing law) and rebuild; the pages are served at `/privacy` and `/terms`. Apple and Google require the privacy policy URL for store listings.
- Last.fm's terms: before opening the app to the public, email partners@last.fm about the 100 MB storage cap and non-commercial use (see `docs/COMPLIANCE.md`).

## 1. Production environment values

Generate a secret once and keep it safe; rotating it invalidates every stored Last.fm session key:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase **transaction pooler** URL (port 6543) |
| `DATABASE_MIGRATE_URL` | Supabase **direct** URL (port 5432) |
| `LASTFM_API_KEY` / `LASTFM_API_SECRET` | from your Last.fm API account |
| `LASTFM_CALLBACK_URL` | `https://api.quiztape.com/v1/auth/lastfm/callback` |
| `CORS_ORIGINS` | `https://quiztape.com,https://www.quiztape.com` |
| `MUSICBRAINZ_APP_NAME` / `MUSICBRAINZ_APP_VERSION` / `MUSICBRAINZ_CONTACT` | `Quiztape` / `0.1.0` / your email |
| `SESSION_SECRET` | the generated secret |
| `ANTHROPIC_API_KEY` | optional, only for AI grading |

## 2. API on Fly.io

From the repository root (the Dockerfile expects the repo as build context):

```
fly launch --copy-config --no-deploy        # uses fly.toml; pick your org, keep the app name or change it in fly.toml
fly secrets set DATABASE_URL='...' DATABASE_MIGRATE_URL='...' \
  LASTFM_API_KEY='...' LASTFM_API_SECRET='...' \
  LASTFM_CALLBACK_URL='https://api.quiztape.com/v1/auth/lastfm/callback' \
  CORS_ORIGINS='https://quiztape.com,https://www.quiztape.com' \
  MUSICBRAINZ_CONTACT='you@example.com' SESSION_SECRET='...'
fly deploy                                   # builds the image, runs `npm run db:migrate` as the release command, starts one machine
fly logs                                     # expect: "quiztape-api listening" and "job runner fly-1 started"
```

Custom domain:

```
fly certs add api.quiztape.com
fly certs show api.quiztape.com              # shows the DNS records to create
```

At your registrar: `CNAME api -> quiztape-api.fly.dev` (or the A/AAAA records Fly lists). Wait for the certificate, then:

```
curl https://api.quiztape.com/health
```

Keep it at one machine. The job runner tolerates several (the queue uses row locks), but MusicBrainz allows one request per second per IP, so more machines do not make ingestion faster.

To run the support views against production from your laptop, point a `.env` at the production URLs and use `npm run db:check` and `npm run db:jobs`.

## 3. Web app on Cloudflare Pages

Create a Pages project connected to the GitHub repository with:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `npm ci && npm run export:web -w @quiztape/client` |
| Build output directory | `apps/client/dist/web` |
| Environment variable | `EXPO_PUBLIC_API_URL=https://api.quiztape.com` |
| Environment variable | `NODE_VERSION=22` |

`apps/client/public/_redirects` already rewrites every path to `index.html`, which the single-page router needs. Then under Custom domains add `quiztape.com` and `www.quiztape.com`; Cloudflare gives you the CNAME records (if the domain's DNS is on Cloudflare it wires them automatically).

Vercel alternative: same build command and output directory, plus a `vercel.json` with `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`.

## 4. Last.fm API account

In https://www.last.fm/api/accounts set the callback URL to `https://api.quiztape.com/v1/auth/lastfm/callback`. The app also passes the callback explicitly on every request, so local development keeps working with the localhost URL in `.env`.

## 5. Smoke test

1. `curl https://api.quiztape.com/health` returns `{"ok":true,...}`.
2. Open `https://quiztape.com`, press Connect, approve on Last.fm, land on the sync screen, watch the percentage climb, land on the config screen, play a Side A round.
3. `fly logs` shows the backfill pages and no errors.
4. `https://quiztape.com/privacy` and `/terms` render with your details filled in.

## 6. Later: native builds

```
cd apps/client
npx eas init                                  # links the project to your Expo account
```

Add `"env": { "EXPO_PUBLIC_API_URL": "https://api.quiztape.com" }` to the `preview` and `production` profiles in `eas.json`, change the bundle identifier and package from the `com.quiztape.app` placeholders, then `eas build --platform all --profile production` and `eas submit`. The sign-in redirect uses the `quiztape://` scheme, which works in development and store builds but not in Expo Go.

## 7. Operating it

- Logs: `fly logs`. Job state: `npm run db:jobs` with production URLs in `.env`.
- Backups: enable Supabase's daily backups (Settings, Database).
- Deploys: `fly deploy` runs migrations first; the job runner hands back any in-flight job on shutdown and resumes from its checkpoint.
- Secret rotation: a new `SESSION_SECRET` means every user reconnects Last.fm once (the `key_version` column exists for a gentler rotation later).
