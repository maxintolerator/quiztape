import type { AnswerFormat, AnswerSubmission, GradingMethod, QuestionOption } from '@quiztape/shared';
import { POINTS_PER_QUESTION, SPEED_BONUS_MAX } from '@quiztape/shared';

import { bestMatch, normalizeText } from './normalize';

/** Similarity at or above this counts as a hit. */
export const FUZZY_ACCEPT = 0.82;
/** Between this and FUZZY_ACCEPT the answer is ambiguous: a candidate for the Claude grader (not wired yet). */
export const FUZZY_AMBIGUOUS = 0.6;

export interface GradeInput {
  answerFormat: AnswerFormat;
  submission: AnswerSubmission;
  correctAnswer: unknown;
  acceptedAnswers: readonly string[];
  numericAnswer: number | null;
  numericTolerance: number | null;
  options: readonly QuestionOption[] | null;
}

export interface GradeResult {
  correct: boolean;
  method: GradingMethod;
  /** Similarity for fuzzy grading, else null. */
  score: number | null;
  yourAnswerDisplay: string | null;
  normalizedText: string | null;
}

export function grade(input: GradeInput): GradeResult {
  const { submission } = input;
  if (submission.kind === 'timeout') return { correct: false, method: 'timeout', score: null, yourAnswerDisplay: null, normalizedText: null };
  if (submission.kind === 'skip') return { correct: false, method: 'skipped', score: null, yourAnswerDisplay: null, normalizedText: null };

  switch (input.answerFormat) {
    case 'multiple_choice': {
      if (submission.kind !== 'option') return wrongKind(submission);
      const option = input.options?.find((o) => o.id === submission.optionId) ?? null;
      const correctId = (input.correctAnswer as { optionId?: string } | null)?.optionId ?? null;
      return {
        correct: option !== null && option.id === correctId,
        method: 'exact',
        score: null,
        yourAnswerDisplay: option?.label ?? null,
        normalizedText: null,
      };
    }
    case 'numeric': {
      if (submission.kind !== 'numeric' || !Number.isFinite(submission.value)) return wrongKind(submission);
      const target = input.numericAnswer ?? Number((input.correctAnswer as { value?: number } | null)?.value);
      const tolerance = input.numericTolerance ?? 0;
      return {
        correct: Number.isFinite(target) && Math.abs(submission.value - target) <= tolerance,
        method: 'numeric_tolerance',
        score: null,
        yourAnswerDisplay: String(submission.value),
        normalizedText: null,
      };
    }
    case 'free_text': {
      if (submission.kind !== 'text') return wrongKind(submission);
      const normalized = normalizeText(submission.text);
      if (!normalized) return { correct: false, method: 'fuzzy', score: 0, yourAnswerDisplay: submission.text.trim() || null, normalizedText: normalized };
      const { score } = bestMatch(submission.text, input.acceptedAnswers);
      if (score === 1) return { correct: true, method: 'exact', score, yourAnswerDisplay: submission.text.trim(), normalizedText: normalized };
      return { correct: score >= FUZZY_ACCEPT, method: 'fuzzy', score, yourAnswerDisplay: submission.text.trim(), normalizedText: normalized };
    }
    case 'order': {
      if (submission.kind !== 'order') return wrongKind(submission);
      const correctOrder = (input.correctAnswer as { order?: string[] } | null)?.order ?? [];
      const labels = new Map((input.options ?? []).map((o) => [o.id, o.label]));
      const given = submission.optionIds;
      const correct = given.length === correctOrder.length && given.every((id, i) => id === correctOrder[i]);
      return {
        correct,
        method: 'exact',
        score: null,
        yourAnswerDisplay: given.map((id) => labels.get(id) ?? '?').join(' → '),
        normalizedText: null,
      };
    }
  }
}

function wrongKind(submission: AnswerSubmission): GradeResult {
  return { correct: false, method: 'exact', score: null, yourAnswerDisplay: describe(submission), normalizedText: null };
}

function describe(submission: AnswerSubmission): string | null {
  switch (submission.kind) {
    case 'text':
      return submission.text;
    case 'numeric':
      return String(submission.value);
    case 'option':
      return submission.optionId;
    case 'order':
      return submission.optionIds.join(' → ');
    default:
      return null;
  }
}

/** Base points for a correct answer plus a speed bonus that decays linearly over the time limit. */
export function awardPoints(correct: boolean, responseMs: number | null, timeLimitSeconds: number, basePoints = POINTS_PER_QUESTION): number {
  if (!correct) return 0;
  if (responseMs === null || timeLimitSeconds <= 0) return basePoints;
  const fraction = Math.max(0, Math.min(1, 1 - responseMs / (timeLimitSeconds * 1000)));
  return basePoints + Math.round(SPEED_BONUS_MAX * fraction);
}
