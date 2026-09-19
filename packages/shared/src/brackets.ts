export const BRACKET_SIZES = [8, 16, 32] as const;
export type BracketSize = (typeof BRACKET_SIZES)[number];
export type BracketStatus = 'active' | 'completed' | 'abandoned';

export interface BracketEntrantDto {
  seed: number;
  artistName: string;
  rank: number;
  /** Revealed only once the bracket is complete; duels would be trivial otherwise. */
  playCount: number | null;
  eliminatedInRound: number | null;
}

export interface BracketMatchDto {
  id: string;
  roundNo: number;
  matchNo: number;
  seedA: number | null;
  seedB: number | null;
  winnerSeed: number | null;
  duelGuessSeed: number | null;
  duelCorrect: boolean | null;
}

export interface BracketDto {
  id: string;
  size: number;
  roundCount: number;
  status: BracketStatus;
  currentRound: number;
  championSeed: number | null;
  duelsCorrect: number;
  duelsTotal: number;
  createdAt: string;
  completedAt: string | null;
}

export interface BracketStateDto {
  bracket: BracketDto;
  entrants: BracketEntrantDto[];
  matches: BracketMatchDto[];
  /** The match waiting for the player: duel first, then the pick. Null when complete. */
  current: BracketMatchDto | null;
}

export interface DuelResultDto {
  match: BracketMatchDto;
  correct: boolean;
  morePlayedSeed: number;
  playsA: number;
  playsB: number;
  bracket: BracketDto;
}

export interface CreateBracketRequest {
  size: BracketSize;
}

/** Human names for rounds counted back from the final. */
export function roundName(roundNo: number, roundCount: number): string {
  const fromEnd = roundCount - roundNo;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round of ${2 ** (fromEnd + 1)}`;
}

/**
 * Standard single-elimination seeding: 1 meets `size` first, 1 and 2 can only
 * meet in the final. Returns seeds in first-round order, pairs adjacent.
 */
export function seedingOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}
