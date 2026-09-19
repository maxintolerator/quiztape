import { API_URL } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? `${code} (${status})`);
    this.name = 'ApiError';
  }
}

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

/** Thin JSON client. Every non-2xx response becomes an ApiError with the server's error code. */
export async function api<T>(path: string, request: ApiRequest = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (request.body !== undefined) headers['Content-Type'] = 'application/json';
  if (request.token) headers.Authorization = `Bearer ${request.token}`;

  const init: RequestInit = { method: request.method ?? 'GET', headers };
  if (request.body !== undefined) init.body = JSON.stringify(request.body);
  if (request.signal) init.signal = request.signal;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch (error) {
    throw new ApiError(0, 'network_error', error instanceof Error ? error.message : 'Network error');
  }

  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const payload = (json ?? {}) as { error?: string; message?: string };
    throw new ApiError(response.status, payload.error ?? 'request_failed', payload.message);
  }
  return json as T;
}
