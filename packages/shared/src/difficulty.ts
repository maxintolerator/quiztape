import type { Difficulty } from './quiz';

/**
 * Difficulty is driven by the artist's play-count rank in the user's library:
 * top 10 = easy, 11 to 50 = medium, 51 to 500 = hard. Anything with fewer than
 * 50 plays is a deep cut regardless of rank, so thin libraries are not all
 * labelled "easy".
 */
export const DIFFICULTY_RULE = {
  easyMaxRank: 10,
  mediumMaxRank: 50,
  hardMaxRank: 500,
  deepCutMaxPlays: 49,
} as const;

export function difficultyFor(rank: number, playCount: number): Difficulty {
  if (playCount <= DIFFICULTY_RULE.deepCutMaxPlays) return 'deep_cut';
  if (rank <= DIFFICULTY_RULE.easyMaxRank) return 'easy';
  if (rank <= DIFFICULTY_RULE.mediumMaxRank) return 'medium';
  if (rank <= DIFFICULTY_RULE.hardMaxRank) return 'hard';
  return 'deep_cut';
}
