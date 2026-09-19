import type { Db } from '@quiztape/db';
import type { AnswerFormat, QuestionCategory, QuestionOption } from '@quiztape/shared';

import type { Rng } from './rng';

/** A question the engine produced, before it is stored. Carries the answer; never leaves the server. */
export interface GeneratedQuestion {
  category: QuestionCategory;
  templateId: string;
  answerFormat: AnswerFormat;
  prompt: string;
  hint: string | null;
  options: QuestionOption[] | null;
  unit: string | null;
  explanation: string | null;
  correctAnswer: unknown;
  correctDisplay: string;
  acceptedAnswers: string[];
  numericAnswer: number | null;
  numericTolerance: number | null;
  anchorArtistKey: string | null;
  anchorYear: number | null;
  factRefs: unknown[];
  fingerprint: string;
}

export interface GeneratorContext {
  db: Db;
  userId: string;
  rng: Rng;
  /** Fingerprints asked recently; generators must not repeat them. */
  recentFingerprints: ReadonlySet<string>;
  /** Anchor artists already used in this round. */
  usedArtistKeys: Set<string>;
}
