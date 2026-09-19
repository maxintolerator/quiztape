import { describe, expect, it } from 'vitest';

import { awardPoints, grade } from './grading';
import { normalizeText, similarity, stripEditionSuffix } from './normalize';

describe('normalizeText', () => {
  it('folds case, accents, punctuation and a leading "the"', () => {
    expect(normalizeText('The Beatles')).toBe('beatles');
    expect(normalizeText('Björk')).toBe('bjork');
    expect(normalizeText("Sigur Rós – Ágætis byrjun")).toBe('sigur ros agaetis byrjun');
    expect(normalizeText('Simon & Garfunkel')).toBe('simon and garfunkel');
    expect(normalizeText("Don't Stop Me Now!")).toBe('dont stop me now');
  });
  it('strips edition suffixes', () => {
    expect(stripEditionSuffix('OK Computer (Remastered)')).toBe('OK Computer');
    expect(stripEditionSuffix('In Rainbows - 2009 Remaster')).toBe('In Rainbows');
    expect(stripEditionSuffix('Kid A')).toBe('Kid A');
  });
});

describe('grade', () => {
  const base = { correctAnswer: null, acceptedAnswers: [], numericAnswer: null, numericTolerance: null, options: null };

  it('accepts near misses and scrambled spellings on free text', () => {
    const q = { ...base, answerFormat: 'free_text' as const, acceptedAnswers: ['Paranoid Android'] };
    expect(grade({ ...q, submission: { kind: 'text', text: 'paranoid android' } })).toMatchObject({ correct: true, method: 'exact' });
    expect(grade({ ...q, submission: { kind: 'text', text: 'Paranoid Andriod' } })).toMatchObject({ correct: true, method: 'fuzzy' });
    expect(grade({ ...q, submission: { kind: 'text', text: 'Karma Police' } })).toMatchObject({ correct: false, method: 'fuzzy' });
    expect(similarity('Paranoid Andriod', 'Paranoid Android')).toBeGreaterThan(0.82);
  });

  it('applies a tolerance band to numeric answers', () => {
    const q = { ...base, answerFormat: 'numeric' as const, numericAnswer: 14, numericTolerance: 3 };
    expect(grade({ ...q, submission: { kind: 'numeric', value: 11 } }).correct).toBe(true);
    expect(grade({ ...q, submission: { kind: 'numeric', value: 18 } }).correct).toBe(false);
    expect(grade({ ...q, submission: { kind: 'text', text: '14' } }).correct).toBe(false);
  });

  it('grades multiple choice by option id and records timeouts and skips', () => {
    const q = { ...base, answerFormat: 'multiple_choice' as const, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], correctAnswer: { optionId: 'b' } };
    expect(grade({ ...q, submission: { kind: 'option', optionId: 'b' } })).toMatchObject({ correct: true, yourAnswerDisplay: 'B' });
    expect(grade({ ...q, submission: { kind: 'option', optionId: 'a' } }).correct).toBe(false);
    expect(grade({ ...q, submission: { kind: 'timeout' } })).toMatchObject({ correct: false, method: 'timeout' });
    expect(grade({ ...q, submission: { kind: 'skip' } })).toMatchObject({ correct: false, method: 'skipped' });
  });
});

describe('awardPoints', () => {
  it('gives base points plus a speed bonus that decays over the timer', () => {
    expect(awardPoints(false, 1000, 20)).toBe(0);
    expect(awardPoints(true, 0, 20)).toBe(150);
    expect(awardPoints(true, 10_000, 20)).toBe(125);
    expect(awardPoints(true, 25_000, 20)).toBe(100);
    expect(awardPoints(true, null, 20)).toBe(100);
  });
});
