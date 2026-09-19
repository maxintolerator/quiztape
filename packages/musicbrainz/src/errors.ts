export class MusicBrainzError extends Error {
  override readonly name: string = 'MusicBrainzError';

  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
  }
}

/** 404 from a lookup: the MBID does not exist (or was deleted without a redirect). */
export class MusicBrainzNotFoundError extends MusicBrainzError {
  override readonly name = 'MusicBrainzNotFoundError';

  constructor(url: string) {
    super('MusicBrainz entity not found', 404, url);
  }
}

/** 400 from search/browse: malformed query or inc combination. Not retryable. */
export class MusicBrainzBadRequestError extends MusicBrainzError {
  override readonly name = 'MusicBrainzBadRequestError';

  constructor(message: string, url: string) {
    super(message, 400, url);
  }
}
