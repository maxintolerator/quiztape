/**
 * Transport-level error raised by every client when the upstream responds with
 * a non-2xx status. Carries the parsed Retry-After so the limiter can pause.
 */
export class HttpError extends Error {
  override readonly name = 'HttpError';

  constructor(
    readonly status: number,
    readonly url: string,
    readonly options: { retryAfterMs?: number | undefined; body?: string | undefined } = {},
  ) {
    super(`HTTP ${status} from ${redact(url)}`);
  }

  get retryAfterMs(): number | undefined {
    return this.options.retryAfterMs;
  }

  get body(): string | undefined {
    return this.options.body;
  }

  /** 429 and 5xx are transient by default; 4xx other than 429 are not. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status === 408 || this.status >= 500;
  }
}

/**
 * Parse an HTTP `Retry-After` header into milliseconds. Accepts delta-seconds
 * or an HTTP-date. Returns undefined when absent or unparseable.
 */
export function parseRetryAfter(header: string | null | undefined, now: number): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/** Strip query-string secrets (api keys, session keys, signatures) from URLs before they reach logs. */
export function redact(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ['api_key', 'sk', 'api_sig', 'token', 'secret', 'key']) {
      if (u.searchParams.has(key)) u.searchParams.set(key, '***');
    }
    return u.toString();
  } catch {
    return url;
  }
}
