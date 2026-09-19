# Quiztape API + job runner. Build context is the repository root:
#   docker build -f apps/api/Dockerfile -t quiztape-api .
FROM node:22-alpine AS deps
WORKDIR /app
ENV NODE_ENV=production
# Workspace manifests first so the install layer is cached until a dependency changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/client/package.json apps/client/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/ratelimit/package.json packages/ratelimit/
COPY packages/lastfm/package.json packages/lastfm/
COPY packages/musicbrainz/package.json packages/musicbrainz/
RUN npm ci --omit=dev --include-workspace-root \
      -w @quiztape/api -w @quiztape/db -w @quiztape/shared \
      -w @quiztape/ratelimit -w @quiztape/lastfm -w @quiztape/musicbrainz

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY packages/ratelimit ./packages/ratelimit
COPY packages/lastfm ./packages/lastfm
COPY packages/musicbrainz ./packages/musicbrainz
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["npm", "run", "start", "-w", "@quiztape/api"]
