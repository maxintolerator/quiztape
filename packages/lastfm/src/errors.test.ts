import { describe, expect, it } from 'vitest';

import { LASTFM_ERROR, LastfmApiError } from './errors';

describe('LastfmApiError', () => {
  it('classifies transient, terminal, privacy and token errors', () => {
    expect(new LastfmApiError(LASTFM_ERROR.RATE_LIMIT_EXCEEDED, 'x', 429).isRetryable).toBe(true);
    expect(new LastfmApiError(LASTFM_ERROR.SERVICE_OFFLINE, 'x', 503).isRetryable).toBe(true);
    expect(new LastfmApiError(LASTFM_ERROR.INVALID_SESSION_KEY, 'x', 403).isRetryable).toBe(false);
    expect(new LastfmApiError(LASTFM_ERROR.INVALID_SESSION_KEY, 'x', 403).isSessionInvalid).toBe(true);
    expect(new LastfmApiError(LASTFM_ERROR.TOKEN_EXPIRED, 'x', 200).isTokenProblem).toBe(true);
    expect(new LastfmApiError(LASTFM_ERROR.LOGIN_REQUIRED, 'x', 200).isPrivacyBlocked).toBe(true);
    expect(new LastfmApiError(LASTFM_ERROR.SUSPENDED_API_KEY, 'x', 403).isRetryable).toBe(false);
  });
});
