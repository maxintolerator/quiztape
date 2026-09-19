# Platform log

Quiztape is one codebase for web, iOS and Android. Every place the platforms diverge is recorded here **before** the code is written, so nothing web-only creeps in unnoticed.

## Verification ladder

| Check | What it proves | Command |
| --- | --- | --- |
| Web dev server | The app boots and renders on web | `npm run web` |
| Native bundle export | iOS and Android Metro bundles compile: module resolution, platform files, no web-only imports | `npm run check:platforms` |
| expo-doctor | SDK/dependency compatibility and config sanity | `npm run doctor` |
| Simulator / device | The app actually runs natively | `npm run ios`, `npm run android`, or Expo Go on a phone |
| EAS Build (cloud) | Release-grade native binaries without local Xcode/Android Studio | `eas build --profile development --platform ios` |

## Machine status (2026-09-19)

The development Mac is Apple Silicon with an Intel-only Homebrew under `/usr/local` and no Rosetta, so `brew`, `psql`, `docker`, `java` and `pod` all fail with "Bad CPU type in executable". There is no Xcode.app (only Command Line Tools) and no Android SDK. Consequences:

- Native simulator smoke tests are **not possible on this machine** until Xcode (from the App Store) or Android Studio is installed. Until then the native checks are the bundle export, expo-doctor, Expo Go on a physical device, and EAS Build simulator builds in the cloud.
- Local Postgres is unavailable; use a Supabase project (`DATABASE_URL` in `.env`) or install Postgres.app (arm64). Schema tests run against PGlite (Postgres in WASM) and need nothing installed.
- Fixing the toolchain: install arm64 Homebrew to `/opt/homebrew`, or `softwareupdate --install-rosetta`.

## Divergences

| Area | Web | iOS / Android | Status |
| --- | --- | --- | --- |
| Global CSS (`apps/client/src/global.css`) | Applies focus-visible ring, reduced-motion, dark colour-scheme | Import resolves to an empty module; the same rules are expressed in RN styles where they matter | Accepted: cosmetic only |
| Session token storage | `localStorage`, guarded, in `src/lib/storage.web.ts` | `expo-secure-store` in `src/lib/storage.ts` (Keychain / Keystore; single small token) | Written |
| Connect start | Full-page redirect through the API and Last.fm (`location.assign` in `src/lib/connect.web.ts`), back to `/auth/callback?code=` on this origin | `WebBrowser.openAuthSessionAsync` in `src/lib/connect.ts`; the API redirects to `quiztape://auth/callback?code=`; Expo Go cannot receive the custom scheme, use a development build | Written |
| Auth callback route | `src/app/auth/callback.tsx` exchanges the code | Same route via deep link; also handled from the auth session result | Written |
| Fonts | `useFonts` at runtime (the config plugin does nothing on web) | `expo-font` config plugin embeds the files; name files by PostScript name so Android and iOS resolve the same family | Step 3 |
| Share card | Web Share API where available, download fallback | `expo-sharing` | Step 5 |
