# Third-party terms that shape the product

Facts below were read from the live terms on 2026-09-19. They are not legal advice; they are the constraints the code is built around. Revisit before public launch.

## Last.fm API terms (https://www.last.fm/api/tos)

| Clause | What it says | What it means for Quiztape |
| --- | --- | --- |
| 3.1 / 3.2 | Non-commercial use only without a commercial agreement. | Fine while free. Any monetisation needs partners@last.fm first. |
| 4.3.4 | "Reasonable Usage Cap": at most **100 MB of Last.fm data stored at any time**; more needs written consent. | Decided 2026-10-03: the scrobble history is not stored on the server at all; each player's device downloads and keeps its own copy. What the server still holds from Last.fm is the username and profile fields, and the play counts and names quoted in stored questions (a few KB per round). Whether copies held on players' own devices count towards the cap is a question for partners@last.fm if the app grows. |
| 4.3.4 | Implement caching in accordance with response HTTP headers. | The client records `Cache-Control`/`ETag` when present. |
| 4.4 | Rate limits at Last.fm's discretion; historically 5 req/s per IP averaged over 5 min. | Server: one shared limiter per process at 5 req/s (one `user.getInfo` per sign-in, nothing else). Devices: the history import runs at about 4.4 req/s from the player's own IP and backs off on error 29. All devices share the one API key, so a key-level limit would hit everyone. |
| 2.7 | Attribution: "powered by AudioScrobbler" mark, link profile pages to last.fm/user/<name> and catalogue pages to Last.fm URLs. Public pages nominally need Last.fm approval. | Add the attribution to the Connect and Results screens (step 3/5). |
| 2.8 / 5.1.6 | Privacy at least as strict as Last.fm's; never use data to identify or contact users. | Store only the Last.fm username and public profile fields; no emails, no Last.fm credentials. Sign-in is by username (2026-10-05), so Quiztape reads only what Last.fm serves without a login: an account that hides its recent listening stays unreadable (error 17). |
| 5.1.8 | Images and artwork are excluded from the licence. | Never store or display Last.fm image URLs. Cover art comes from the Cover Art Archive. |
| 9.3 | Delete all Last.fm data on termination. | User deletion cascades on the server and erases the library on the device it is done from. Copies on a player's other devices cannot be reached from the server. |
| Error 17 | Users who hide recent listening in privacy settings return "login required". | First-class empty state: explain and link to the privacy setting. |

## MusicBrainz (https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)

- 1 request per second per IP on average; bursts are refused with 503 until the rate drops. One limiter per egress IP; multi-instance deployments must share it.
- A User-Agent with contact details is required (`Quiztape/0.1.0 ( email )`). Anonymous agents share a global 50 req/s pool and get throttled.
- Core data is CC0. Cover Art Archive images have their own per-image status; store the resolved archive.org URL, not a copy.

## Wikidata (https://www.wikidata.org/wiki/Wikidata:Data_access)

- Data is CC0; the project asks for "Powered by Wikidata" attribution.
- 2026 global Wikimedia limits: 10 requests/min for clients identified only by IP, so a descriptive User-Agent with contact and a single serialised worker are mandatory. WDQS additionally allows 5 parallel queries and 60 s of processing per minute per client.
- Prefer the MusicBrainz url-rel of type `wikidata` (free) over any Wikidata lookup.

## Claude API

Used only to rephrase templated questions and to grade ambiguous free-text answers. Never for facts. No user history is sent beyond the single question and answer being graded.
