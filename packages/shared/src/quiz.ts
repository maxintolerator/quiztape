/**
 * The cassette vocabulary. Side A = the user's own stats, Side B = trivia
 * about the artists in their library, Mixtape = both, Bracket = tournament.
 */
export const QUIZ_MODES = ['side_a', 'side_b', 'mixtape', 'bracket'] as const;
export type QuizMode = (typeof QUIZ_MODES)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'deep_cut'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const ROUND_LENGTHS = [5, 10, 20] as const;
export type RoundLength = (typeof ROUND_LENGTHS)[number];

/**
 * Every question category the engine can generate. Side A categories are pure
 * functions over the user's scrobbles; Side B categories join the user's
 * artists to cached MusicBrainz facts.
 */
export const SIDE_A_CATEGORIES = [
  'stats_artist_rank',
  'stats_top_track_for_artist',
  'stats_top_album',
  'stats_discovery_order',
  'stats_year_chart_topper',
  'stats_head_to_head',
] as const;

export const SIDE_B_CATEGORIES = [
  'disco_order_albums',
  'disco_release_year',
  'titles_album_contains_track',
  'titles_album_opener',
  'titles_album_closer',
  'cross_shared_members',
  'cross_side_project',
  'cross_member_joined_left',
  'duration_track_runtime',
  // Optional toggles, default off per user.
  'geo_origin',
  'producer',
  'label',
] as const;

export const QUESTION_CATEGORIES = [...SIDE_A_CATEGORIES, ...SIDE_B_CATEGORIES] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];
export type SideACategory = (typeof SIDE_A_CATEGORIES)[number];
export type SideBCategory = (typeof SIDE_B_CATEGORIES)[number];

/** Categories that are off unless the user switches them on. */
export const OPTIONAL_CATEGORIES = ['geo_origin', 'producer', 'label'] as const satisfies readonly QuestionCategory[];
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];

export function isSideA(category: QuestionCategory): category is SideACategory {
  return (SIDE_A_CATEGORIES as readonly string[]).includes(category);
}

export function isOptionalCategory(category: QuestionCategory): category is OptionalCategory {
  return (OPTIONAL_CATEGORIES as readonly string[]).includes(category);
}

/** How a submitted answer was judged. */
export const GRADING_METHODS = ['exact', 'numeric_tolerance', 'fuzzy', 'llm', 'timeout', 'skipped'] as const;
export type GradingMethod = (typeof GRADING_METHODS)[number];
