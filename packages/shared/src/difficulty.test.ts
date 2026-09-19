import { describe, expect, it } from 'vitest';

import { difficultyFor } from './difficulty';

describe('difficultyFor', () => {
  it('maps rank tiers from the brief', () => {
    expect(difficultyFor(1, 2000)).toBe('easy');
    expect(difficultyFor(10, 400)).toBe('easy');
    expect(difficultyFor(11, 300)).toBe('medium');
    expect(difficultyFor(50, 120)).toBe('medium');
    expect(difficultyFor(51, 100)).toBe('hard');
    expect(difficultyFor(500, 60)).toBe('hard');
    expect(difficultyFor(501, 55)).toBe('deep_cut');
  });

  it('treats anything under 50 plays as a deep cut regardless of rank', () => {
    expect(difficultyFor(3, 49)).toBe('deep_cut');
    expect(difficultyFor(3, 50)).toBe('easy');
  });
});
