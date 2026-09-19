import type { Difficulty, QuizMode } from './quiz';

export type ClientPlatform = 'web' | 'ios' | 'android';

export interface PublicUser {
  id: string;
  lastfmUsername: string;
  lastfmUrl: string | null;
  realName: string | null;
}

export type SyncPhase = 'pending' | 'backfilling' | 'complete' | 'privacy_blocked' | 'error';

/** Side B readiness: how much of the user's library has MusicBrainz facts behind it. */
export interface TriviaSummary {
  /** Artists with enough plays to be asked about. */
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

export interface SyncSummary {
  phase: SyncPhase;
  trivia: TriviaSummary;
  scrobbleCount: number;
  /** 0..100 while backfilling; 100 once complete; null when unknown. */
  percent: number | null;
  pagesDone: number | null;
  pagesTotal: number | null;
  oldestPlayedAt: string | null;
  newestPlayedAt: string | null;
  statsBuiltAt: string | null;
  lastError: string | null;
}

/** The library is playable once the backfill finished and the rollups exist. */
export function isLibraryReady(sync: SyncSummary | null | undefined): boolean {
  return !!sync && sync.phase === 'complete' && sync.statsBuiltAt !== null;
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
  sync: SyncSummary;
}

export interface ExchangeResponse {
  token: string;
  user: PublicUser;
}
