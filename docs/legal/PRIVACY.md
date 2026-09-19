# Privacy Policy

_Effective 2026-09-19. Source of truth: `packages/shared/src/legal.ts`, served in-app at /privacy. Regenerate with `npm run legal:render`._

Quiztape turns your Last.fm listening history into a music quiz. It is a non-commercial project run by a private individual, not a company. This policy explains what data Quiztape handles, why, where it lives, and how you can get rid of it. Connecting your Last.fm account means you have read this policy and agree to it.

## Who is responsible

Quiztape is operated by Max Weidemann, a private individual (homepage: https://intolerator.com). Contact for anything in this policy: max@intolerator.com. A postal address is available on request by email.

## What data Quiztape processes

Last.fm account data: your Last.fm username, profile URL, the real name and country you made public on Last.fm, your registration date and total play count. Quiztape uses these to identify your account and show your name in the app.

Listening history: every scrobble Last.fm reports for your account (artist, track, album, timestamp, and whether you marked it as loved). Quiztape imports your full history once and then fetches only new plays when you open the app or press refresh. All quiz statistics are computed from this copy.

Last.fm session key: the key Last.fm issues when you approve Quiztape. It is stored encrypted and used only to read data. Quiztape never scrobbles, loves, tags or changes anything on your Last.fm account.

Quiz data: the rounds you play, the questions asked, your answers, scores, streaks and your settings (difficulty, timer, optional question categories).

Technical data: a login token for your device (stored as a hash on the server and in secure storage or browser storage on your device), the platform you use (web, iOS, Android), and short-lived server logs that include your IP address for error diagnosis and abuse prevention.

Optional AI grading: if enabled in settings, the text of a quiz question and the answer you typed may be sent to Anthropic (Claude API) to judge an ambiguous free-text answer or to rephrase a question. Your listening history, username and account data are never sent.

## Why and on what legal basis

Quiztape processes this data to provide the service you asked for: importing your history, generating questions from it, grading your answers and remembering your results. Under the GDPR this is performance of the agreement between you and Quiztape (Art. 6(1)(b)) and, for the optional AI grading, your consent (Art. 6(1)(a)), which you can withdraw in settings at any time.

Quiztape does not show advertising, does not use analytics or tracking services, does not build profiles for third parties and does not sell or rent data.

## Where the data is stored and who else touches it

Database: hosted Postgres at Supabase, region [EU or US region of your project]. Application server: [hosting provider and region]. Web app: [static hosting provider]. These providers process data on Quiztape’s behalf under their standard data processing terms.

Last.fm (Last.fm Ltd) is the source of your account data and listening history; Quiztape reads it through the official Last.fm API under Last.fm’s terms.

MusicBrainz and Wikidata provide facts about artists and albums (release years, band members, track listings). Quiztape looks these up by artist name and public identifiers only; none of your personal data is sent to them.

Anthropic receives question text and typed answers only if you enable AI grading, as described above.

## How long data is kept

Your account data, listening history and quiz data are kept for as long as you have a Quiztape account. When you delete your account in the app, everything Quiztape holds about you is deleted immediately, including your listening history, session key, rounds and answers. Cached facts about artists and albums are not personal data and are kept.

Server logs are deleted after at most 30 days.

You can also revoke Quiztape’s access in your Last.fm settings under Applications. That invalidates the session key; your Quiztape account and its data remain until you delete them.

## Your rights

You have the right to access the data Quiztape holds about you, to have it corrected or deleted, to restrict or object to its processing, and to receive it in a portable format. Deletion is available directly in the app; for everything else, email the address above and it will be handled within one month.

If you believe your data is being handled unlawfully you can lodge a complaint with your local data protection authority.

## Cookies and local storage

Quiztape sets no cookies. The web app keeps your login token in the browser’s local storage; the native apps keep it in the device’s secure storage. Nothing else is stored on your device.

## Children

Quiztape is not directed at children under 16 and does not knowingly process their data. Last.fm accounts require a minimum age under Last.fm’s own terms.

## Changes to this policy

If this policy changes in a way that matters to you, the app will say so the next time you open it and the effective date above will move. The current version is always at https://quiztape.com/privacy.
