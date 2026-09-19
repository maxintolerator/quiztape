# Deploying Quiztape to quiztape.com

Three pieces, three hosts. The API is a long-running Node process (it carries the job runner), the web app is a static single-page bundle, and Postgres already lives at Supabase.

| Piece | Host | URL |
| --- | --- | --- |
| Web app (Expo static export) | Cloudflare Pages (or Vercel / Netlify) | `https://quiztape.com`, `https://www.quiztape.com` |
| API + job runner (Docker) | Fly.io, region `iad` (or Railway / Render, anything that runs a container 24/7) | `https://api.quiztape.com` |
| Postgres | Supabase (existing project) | pooler on 6543 for the API, direct 5432 for migrations |

Serverless is deliberately not used for the API: the backfill runs for minutes per user and needs a process that stays up.

## 0. Before you start

- Domain `quiztape.com` at a registrar where you can edit DNS.
- Accounts: Fly.io, Cloudflare (Pages), Supabase (existing).
- Fly.io CLI: `curl -L https://fly.io/install.sh | sh`, then add `~/.fly/bin` to your PATH and run `flyctl auth login`. The command is `flyctl`; do not `npm install -g fly`, that is an unrelated JavaScript task runner.
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
flyctl launch --copy-config --no-deploy     # uses fly.toml; answer "No" to tweaking settings; if the name is taken pick another
flyctl secrets set DATABASE_URL='...' DATABASE_MIGRATE_URL='...' \
  LASTFM_API_KEY='...' LASTFM_API_SECRET='...' \
  LASTFM_CALLBACK_URL='https://api.quiztape.com/v1/auth/lastfm/callback' \
  CORS_ORIGINS='https://quiztape.com,https://www.quiztape.com' \
  MUSICBRAINZ_CONTACT='max@intolerator.com' SESSION_SECRET='...'
flyctl deploy                                # remote build of apps/api/Dockerfile, runs `npm run db:migrate`, starts one machine
flyctl logs                                  # expect: "quiztape-api listening" and "job runner fly-1 started"
```

Custom domain:

```
flyctl certs add api.quiztape.com
flyctl certs show api.quiztape.com           # shows the DNS records to create
```

At your registrar: `CNAME api -> <your-app-name>.fly.dev` (or the A/AAAA records Fly lists). Wait for `flyctl certs check api.quiztape.com` to report the certificate as issued, then:

```
curl https://api.quiztape.com/health
```

Keep it at one machine. The job runner tolerates several (the queue uses row locks), but MusicBrainz allows one request per second per IP, so more machines do not make ingestion faster.

To run the support views against production from your laptop, point a `.env` at the production URLs and use `npm run db:check` and `npm run db:jobs`.

## 3. Web app on Cloudflare Pages

The web app is a static single-page bundle: HTML, JS and fonts, no server. Cloudflare Pages hosts it for free on its CDN. Two things to decide first:

- **How Cloudflare gets the code.** Option A connects a GitHub repository and rebuilds on every push (recommended once the repo is on GitHub). Option B uploads a build from your laptop with the Wrangler CLI (works today, no GitHub needed).
- **Where DNS lives.** Cloudflare Pages can only serve the bare domain `quiztape.com` if the domain’s DNS is hosted at Cloudflare. Moving nameservers is free and takes one registrar change; the `api` record for Fly can then live there too. If you keep DNS elsewhere you can still map `www.quiztape.com` with a CNAME, but not the bare domain.

### 3a. Put the domain on Cloudflare DNS

1. https://dash.cloudflare.com → **Add a domain** → `quiztape.com` → Free plan. Cloudflare imports your existing records and shows two nameservers.
2. At your registrar, replace the nameservers with the two Cloudflare gave you. Propagation takes minutes to a few hours; the Cloudflare overview page turns to “Active”.
3. While there, add the API record: **DNS → Records → Add**: type `CNAME`, name `api`, target `<your-fly-app>.fly.dev`, **Proxy status: DNS only** (grey cloud). Fly issues its own certificate and needs to see the traffic directly.

### 3b-A. Deploy from GitHub (auto-deploys)

The current Cloudflare dashboard creates a **Worker** with static assets when you connect a Git repository (the older "Pages" flow has no deploy command). `wrangler.jsonc` at the repo root tells Wrangler to upload the export directory with single-page routing, so the default deploy command works unchanged.

1. Push the repository to GitHub (already done: `maxintolerator/quiztape`).
2. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → pick `quiztape`.
3. Build settings:

   | Field | Value |
   | --- | --- |
   | Project / Worker name | `quiztape` (gives `quiztape.<account>.workers.dev`) |
   | Build command | `npm ci && npm run export:web -w @quiztape/client` |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | leave as `/` (the npm workspace root) |

4. **Build variables** (Settings → Build → Variables and secrets, for the production branch): `EXPO_PUBLIC_API_URL` = `https://api.quiztape.com`, `NODE_VERSION` = `22`. The API URL is baked into the bundle at build time, so changing it later means a rebuild.
5. **Save and Deploy.** First build takes 3–5 minutes. The result is live at the `workers.dev` URL; test the connect flow there first (add that origin to `CORS_ORIGINS` on Fly temporarily if you want sign-in to work before the custom domain exists).

### 3b-B. Deploy from your laptop (no GitHub)

```
cd /Users/mwe/Desktop/Projects/fun/quiztape
EXPO_PUBLIC_API_URL=https://api.quiztape.com npm run export:web -w @quiztape/client
npx wrangler login                                   # opens the browser once
npx wrangler pages project create quiztape --production-branch main
npx wrangler pages deploy apps/client/dist/web --project-name quiztape
```

Repeat the export and the last command for every release.

### 3c. Custom domain

1. Worker → **Settings → Domains & Routes → Add → Custom domain** → `quiztape.com`. Because DNS is on Cloudflare it creates the record and certificate itself. (Pages projects: Custom domains → Set up a custom domain.)
2. Repeat for `www.quiztape.com`.
3. Optional redirect from `www` to the bare domain: **Rules → Redirect Rules** or a Bulk Redirect; not required.
4. `https://quiztape.com/privacy` should load within a minute or two once the certificate is issued.

Deep links such as `/auth/callback?code=...` and `/play/<id>` resolve to the app because `wrangler.jsonc` sets `not_found_handling` to single-page-application. Do not add a `public/_redirects` file: Workers static hosting rejects a catch-all rewrite to `index.html` as a redirect loop. (Netlify or Pages would need one; use `/*  /index.html  200` there.)

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

- Logs: `flyctl logs`. Job state: `npm run db:jobs` with production URLs in `.env`.
- Backups: enable Supabase's daily backups (Settings, Database).
- Deploys: `flyctl deploy` runs migrations first; the job runner hands back any in-flight job on shutdown and resumes from its checkpoint.
- Secret rotation: a new `SESSION_SECRET` means every user reconnects Last.fm once (the `key_version` column exists for a gentler rotation later).
