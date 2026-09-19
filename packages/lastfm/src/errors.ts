/** Numeric error codes documented at https://www.last.fm/api/errorcodes (plus method-specific 14/15 on auth.getSession). */
export const LASTFM_ERROR = {
  INVALID_SERVICE: 2,
  INVALID_METHOD: 3,
  AUTHENTICATION_FAILED: 4,
  INVALID_FORMAT: 5,
  INVALID_PARAMETERS: 6,
  INVALID_RESOURCE: 7,
  OPERATION_FAILED: 8,
  INVALID_SESSION_KEY: 9,
  INVALID_API_KEY: 10,
  SERVICE_OFFLINE: 11,
  INVALID_SIGNATURE: 13,
  /** auth.getSession: the user has not approved the token yet. */
  TOKEN_NOT_AUTHORIZED: 14,
  /** auth.getSession: tokens live 60 minutes and are single use. */
  TOKEN_EXPIRED: 15,
  TEMPORARY_ERROR: 16,
  /** The user hides recent listening in their privacy settings; history is unavailable. */
  LOGIN_REQUIRED: 17,
  SUSPENDED_API_KEY: 26,
  DEPRECATED: 27,
  RATE_LIMIT_EXCEEDED: 29,
} as const;

export type LastfmErrorCode = (typeof LASTFM_ERROR)[keyof typeof LASTFM_ERROR];

const RETRYABLE = new Set<number>([
  LASTFM_ERROR.OPERATION_FAILED,
  LASTFM_ERROR.SERVICE_OFFLINE,
  LASTFM_ERROR.TEMPORARY_ERROR,
  LASTFM_ERROR.RATE_LIMIT_EXCEEDED,
]);

/**
 * An error reported in the response body. Last.fm's HTTP status codes are not
 * reliable (error 6 has been seen as 400, error 10 as 403, error 29 as 429 or
 * 200), so the client always parses the body and raises this.
 */
export class LastfmApiError extends Error {
  override readonly name = 'LastfmApiError';

  constructor(
    readonly code: number,
    message: string,
    readonly httpStatus: number,
  ) {
    super(`Last.fm error ${code}: ${message}`);
  }

  get isRetryable(): boolean {
    return RETRYABLE.has(this.code);
  }

  get isRateLimit(): boolean {
    return this.code === LASTFM_ERROR.RATE_LIMIT_EXCEEDED;
  }

  /** The user's session key was revoked or never valid: the user must reconnect. */
  get isSessionInvalid(): boolean {
    return this.code === LASTFM_ERROR.INVALID_SESSION_KEY || this.code === LASTFM_ERROR.AUTHENTICATION_FAILED;
  }

  /** The auth token cannot be exchanged (not approved, expired, or already used): restart the connect flow. */
  get isTokenProblem(): boolean {
    return this.code === LASTFM_ERROR.TOKEN_NOT_AUTHORIZED || this.code === LASTFM_ERROR.TOKEN_EXPIRED;
  }

  /** The user's Last.fm privacy settings hide their history: a first-class empty state, not a bug. */
  get isPrivacyBlocked(): boolean {
    return this.code === LASTFM_ERROR.LOGIN_REQUIRED;
  }
}
