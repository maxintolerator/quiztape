# Privacy Policy

_Effective 2026-10-05. Source of truth: `packages/shared/src/legal.ts`, served in-app at /privacy. Regenerate with `npm run legal:render`._

Quiztape turns your Last.fm listening history into a music quiz. It is a non-commercial project run by a private individual, not a company. This policy explains what data Quiztape handles, why, where it lives, and how you can get rid of it. Signing in with your Last.fm username means you have read this policy and agree to it.

## Who is responsible

Quiztape is operated by Max Weidemann, a private individual (homepage: https://intolerator.com). Contact for anything in this policy: max@intolerator.com. A postal address is available on request by email.

## What data Quiztape processes

Last.fm account data: your Last.fm username, profile URL, the real name and country you made public on Last.fm, your registration date and total play count. Quiztape uses these to identify your account and show your name in the app.

Listening history: every scrobble Last.fm reports for your account (artist, track, album and timestamp). Your browser or app downloads this history directly from Last.fm and keeps it on your own device; it is not stored on Quiztape’s servers. It fetches only new plays when you open the app or press refresh, and all quiz statistics are computed on your device from this copy.

Library summary: when you start a round, your device sends a summary of your library (your most played artists with play counts, their top tracks and albums, first-play dates and yearly chart toppers) so the server can write the questions. The summary is used for that request and not kept; what is kept are the questions it produced, which mention the artists, tracks and play counts they ask about. The names of your 50 most played artists are also sent so that public facts about those artists can be looked up; they sit in the server’s work queue while that happens.

No Last.fm login: you sign in by typing your Last.fm username. Quiztape never asks for your Last.fm password, holds no key to your Last.fm account, and can only read what your Last.fm profile already shows publicly. It never scrobbles, loves, tags or changes anything on your Last.fm account. Because a username is all it takes, anyone who types yours can play quizzes cut from your public listening history (which anyone can already browse on Last.fm), and their rounds are filed under that username.

Quiz data: the rounds you play, the questions asked, your answers, scores, streaks and your settings (difficulty, timer, optional question categories).

Technical data: a login token for your device (stored as a hash on the server and in secure storage or browser storage on your device), the platform you use (web, iOS, Android), and short-lived server logs that include your IP address for error diagnosis and abuse prevention.

Optional AI grading: if enabled in settings, the text of a quiz question and the answer you typed may be sent to Anthropic (Claude API) to judge an ambiguous free-text answer or to rephrase a question. Your listening history, username and account data are never sent.

## Why

Quiztape processes this data for one reason: to provide the service you asked for by signing in with your username. That means generating questions from your library, grading your answers and remembering your results. The optional AI grading only runs if you switch it on in settings, and you can switch it off again at any time.

Quiztape does not show advertising, does not use analytics or tracking services, does not build profiles for anyone else and does not sell, rent or share your data for money or for marketing.

## Where the data is stored and who else touches it

Database: hosted Postgres at Supabase, region [EU or US region of your project]. Application server: [hosting provider and region]. Web app: [static hosting provider]. These providers process data on Quiztape’s behalf under their standard data processing terms.

Last.fm (Last.fm Ltd) is the source of your account data and listening history; Quiztape reads it through the official Last.fm API under Last.fm’s terms. Because your device fetches the history itself, Last.fm sees those requests coming from your own IP address.

MusicBrainz and Wikidata provide facts about artists and albums (release years, band members, track listings). Quiztape looks these up by artist name and public identifiers only; none of your personal data is sent to them.

Anthropic receives question text and typed answers only if you enable AI grading, as described above.

## How long data is kept

Your account data and quiz data are kept for as long as you have a Quiztape account. When you delete your account in the app, everything Quiztape holds about you is deleted immediately, including your rounds and answers, and the copy of your listening history on the device you are using is erased. Copies on other devices or browsers you used stay there until you clear that browser’s site data or uninstall the app. Cached facts about artists and albums are not personal data and are kept.

Server logs are deleted after at most 30 days.

## Your choices

You can delete your account and every piece of data Quiztape holds about you directly in the app, at any time, no questions asked. If you would like a copy of your data or want something corrected, email the address above and it will be handled within 30 days.

You can also cut Quiztape off at the source by turning on “Hide recent listening information” in your Last.fm privacy settings; Quiztape can then read no new plays.

## Cookies and local storage

Quiztape sets no cookies. The web app keeps your login token in the browser’s local storage and your listening history in the browser’s IndexedDB storage; the native apps keep the token in the device’s secure storage and the history in the app’s own database. Signing out leaves the history on the device so it does not have to be downloaded again; deleting your account erases it. On the web you can also save the history as a file, and load such a file back.

## Children

Quiztape is not directed at children under 16 and does not knowingly process their data. Last.fm accounts require a minimum age under Last.fm’s own terms.

## Changes to this policy

If this policy changes in a way that matters to you, the app will say so the next time you open it and the effective date above will move. The current version is always at https://quiztape.com/privacy.
