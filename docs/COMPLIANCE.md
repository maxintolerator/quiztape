# Third-party terms that shape the product

Facts below were read from the live terms on 2026-09-19. They are not legal advice; they are the constraints the code is built around. Revisit before public launch.

## Last.fm API terms (https://www.last.fm/api/tos)

| Clause | What it says | What it means for Quiztape |
| --- | --- | --- |
| 3.1 / 3.2 | Non-commercial use only without a commercial agreement. | Fine while free. Any monetisation needs partners@last.fm first. |
| 4.3.4 | "Reasonable Usage Cap": at most **100 MB of Last.fm data stored at any time**; more needs written consent. | A full scrobble cache for many users will exceed this. **Decision needed:** email partners@last.fm for consent before public launch, or cap the stored history per user. Flagged to the owner. |
| 4.3.4 | Implement caching in accordance with response HTTP headers. | The client records `Cache-Control`/`ETag` when present. |
| 4.4 | Rate limits at Last.fm's discretion; historically 5 req/s per IP averaged over 5 min. | One shared limiter per process at 5 req/s. |
| 2.7 | Attribution: "powered by AudioScrobbler" mark, link profile pages to last.fm/user/<name> and catalogue pages to Last.fm URLs. Public pages nominally need Last.fm approval. | Add the attribution to the Connect and Results screens (step 3/5). |
| 2.8 / 5.1.6 | Privacy at least as strict as Last.fm's; never use data to identify or contact users. | Store only the Last.fm username and scrobbles; no emails. |
| 5.1.8 | Images and artwork are excluded from the licence. | Never store or display Last.fm image URLs. Cover art comes from the Cover Art Archive. |
| 9.3 | Delete all Last.fm data on termination. | User deletion cascades; a full purge script ships with step 2. |
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
