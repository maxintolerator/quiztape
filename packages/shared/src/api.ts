import type { Difficulty, QuizMode } from './quiz';

export type ClientPlatform = 'web' | 'ios' | 'android';

export interface PublicUser {
  id: string;
  lastfmUsername: string;
  lastfmUrl: string | null;
  realName: string | null;
}

/** Side B readiness: how much of the user's library has MusicBrainz facts behind it. */
export interface TriviaSummary {
  /** Artists the summary was asked about: the player's most played, capped at TRIVIA_ARTIST_CAP. */
  eligibleArtists: number;
  /** Of those, mapped to a MusicBrainz artist. */
  resolvedArtists: number;
  /** Of those, with a studio discography and tracklists cached. */
  readyArtists: number;
  /** Enough ready artists to cut a Side B round. */
  ready: boolean;
  /** An ingestion job is queued or running right now. */
  running: boolean;
}

export interface UserSettingsDto {
  geoOriginEnabled: boolean;
  producerEnabled: boolean;
  labelEnabled: boolean;
  defaultMode: QuizMode;
  defaultDifficulty: Difficulty;
  defaultRoundLength: number;
  timerSeconds: number;
  timezone: string;
  llmRephraseEnabled: boolean;
}

export interface MeResponse {
  user: PublicUser;
  /** The app's Last.fm API key (an identifier, not the secret): the client reads the player's history with it. */
  lastfm: { apiKey: string };
}

export interface ExchangeResponse {
  token: string;
  user: PublicUser;
}
