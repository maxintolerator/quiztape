import type { Difficulty, GradingMethod, QuestionCategory, QuizMode, RoundLength } from './quiz';

export type AnswerFormat = 'multiple_choice' | 'free_text' | 'numeric' | 'order';
export type RoundStatus = 'draft' | 'active' | 'completed' | 'abandoned';

export interface QuestionOption {
  id: string;
  label: string;
}

/** A question as the client sees it: never carries the correct answer. */
export interface QuestionDto {
  id: string;
  position: number;
  total: number;
  category: QuestionCategory;
  side: 'a' | 'b';
  difficulty: Difficulty;
  answerFormat: AnswerFormat;
  prompt: string;
  hint: string | null;
  options: QuestionOption[] | null;
  unit: string | null;
  timeLimitSeconds: number;
  points: number;
}

export interface RoundDto {
  id: string;
  mode: QuizMode;
  difficulty: Difficulty;
  status: RoundStatus;
  questionCount: number;
  currentIndex: number;
  score: number;
  maxScore: number;
  correctCount: number;
  bestStreak: number;
  currentStreak: number;
  timerSeconds: number;
  createdAt: string;
  completedAt: string | null;
}

export interface RoundStateDto {
  round: RoundDto;
  question: QuestionDto | null;
}

export type AnswerSubmission =
  | { kind: 'text'; text: string }
  | { kind: 'numeric'; value: number }
  | { kind: 'option'; optionId: string }
  | { kind: 'timeout' }
  | { kind: 'skip' };

export interface AnswerResultDto {
  questionId: string;
  correct: boolean;
  correctDisplay: string;
  yourAnswerDisplay: string | null;
  explanation: string | null;
  gradingMethod: GradingMethod;
  pointsAwarded: number;
  round: RoundDto;
  nextQuestion: QuestionDto | null;
}

export interface RoundRecapItem {
  position: number;
  category: QuestionCategory;
  prompt: string;
  correctDisplay: string;
  yourAnswerDisplay: string | null;
  explanation: string | null;
  correct: boolean;
  pointsAwarded: number;
  responseMs: number | null;
}

export interface RoundResultsDto {
  round: RoundDto;
  items: RoundRecapItem[];
  user: { lastfmUsername: string };
}

export interface CreateRoundRequest {
  mode: QuizMode;
  difficulty: Difficulty;
  length: RoundLength;
}

/** Base points per question; a speed bonus of up to half again is added for quick correct answers. */
export const POINTS_PER_QUESTION = 100;
export const SPEED_BONUS_MAX = 50;
/** Fewer ranked artists than this and Side A cannot build a round. */
export const MIN_ARTISTS_FOR_ROUND = 8;
