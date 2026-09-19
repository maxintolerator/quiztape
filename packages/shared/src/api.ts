import type { Difficulty, QuizMode } from './quiz';

export type ClientPlatform = 'web' | 'ios' | 'android';

export interface PublicUser {
  id: string;
  lastfmUsername: string;
  lastfmUrl: string | null;
  realName: string | null;
}

export type SyncPhase = 'pending' | 'backfilling' | 'complete' | 'privacy_blocked' | 'error';

export interface SyncSummary {
  phase: SyncPhase;
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
