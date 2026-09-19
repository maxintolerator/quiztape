import type { Release, ReleaseGroup } from '@quiztape/musicbrainz';

/** Partial MusicBrainz dates: 'YYYY', 'YYYY-MM', 'YYYY-MM-DD' or ''. */
export function yearOf(date: string | null | undefined): number | null {
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) && year > 0 ? year : null;
}

export function isCompleteDate(date: string | null | undefined): boolean {
  return !!date && /^\d{4}-\d{2}-\d{2}$/.test(date);
}

const EDITION_WORDS = /deluxe|bonus|club|reissue|remaster|anniversary|expanded|special|limited|box|collector|tour edition|japan/i;
const PREFERRED_FORMATS = new Set(['CD', 'Digital Media']);

export interface CanonicalPick {
  release: Release;
  score: number;
}

/**
 * Choose the release that stands for the album: official, dated like the
 * group's first release, a single CD or digital medium with the usual track
 * count, from the artist's home market, and not a deluxe or reissue edition.
 * Pure so it can be re-run on cached data without a request.
 */
export function pickCanonicalRelease(group: Pick<ReleaseGroup, 'first-release-date'>, releases: readonly Release[], artistCountry: string | null): CanonicalPick | null {
  const official = releases.filter((r) => r.status === 'Official');
  if (official.length === 0) return null;
  const firstDate = group['first-release-date'] ?? '';
  const firstYear = yearOf(firstDate);
  const trackCounts = official.map(totalTracks).filter((n) => n > 0);
  const modalTracks = mode(trackCounts);
  const homeCountries = new Set([artistCountry, 'XW', 'XE', 'GB', 'US'].filter(Boolean) as string[]);

  let best: CanonicalPick | null = null;
  for (const release of official) {
    let score = 0;
    const date = release.date ?? '';
    if (isCompleteDate(date) && date === firstDate) score += 40;
    else if (isCompleteDate(date) && yearOf(date) === firstYear) score += 25;
    else if (yearOf(date) === firstYear) score += 15;
    else if (date) score += 5;
    const media = release.media ?? [];
    if (media.length === 1) score += 20;
    if (media[0]?.format && PREFERRED_FORMATS.has(media[0].format)) score += 10;
    if (modalTracks !== null && totalTracks(release) === modalTracks) score += 15;
    if (release.country && homeCountries.has(release.country)) score += 10;
    if (release.quality === 'low') score -= 30;
    if (EDITION_WORDS.test(release.disambiguation ?? '')) score -= 25;
    if (EDITION_WORDS.test(release.title ?? '') && !EDITION_WORDS.test(firstDate)) score -= 10;
    if (!best || score > best.score || (score === best.score && (release.date ?? '') < (best.release.date ?? ''))) best = { release, score };
  }
  return best;
}

export function totalTracks(release: Release): number {
  return (release.media ?? []).reduce((sum, medium) => sum + (medium['track-count'] ?? medium.tracks?.length ?? 0), 0);
}

function mode(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: [number, number] | null = null;
  for (const entry of counts) if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0] < best[0])) best = entry;
  return best ? best[0] : null;
}
