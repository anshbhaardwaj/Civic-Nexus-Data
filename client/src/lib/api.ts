/**
 * Thin typed client over the CivicData Nexus REST API.
 *
 * The JWT is passed in explicitly on every call — it lives in React state only
 * (SPEC §2): no localStorage, no sessionStorage, no cookies.
 */

export const API_BASE = ((): string => {
  const injected = (import.meta.env['VITE_API_BASE'] as string | undefined) ?? '';
  if (injected) return injected.replace(/\/$/, '');
  // Vite dev server runs on another port; the API is always :5000 in this build.
  if (import.meta.env.DEV && typeof window !== 'undefined' && window.location.port !== '5000') {
    return `${window.location.protocol}//${window.location.hostname}:5000`;
  }
  return '';
})();

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorShape) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }

  get isDenied(): boolean {
    return this.status === 403 || this.code === 'FORBIDDEN';
  }
  get isUnauthorised(): boolean {
    return this.status === 401;
  }
  get isNotApplicable(): boolean {
    return this.code === 'NOT_APPLICABLE';
  }
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export interface RequestOptions {
  token?: string | null;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: RequestOptions['query']): string {
  const qs = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      qs.set(k, String(v));
    }
  }
  const suffix = qs.toString();
  return `${API_BASE}${path}${suffix ? `?${suffix}` : ''}`;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { token, method = 'GET', body, query, signal } = opts;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, {
      code: 'NETWORK_ERROR',
      message: `Cannot reach the CivicData Nexus API at ${API_BASE || window.location.origin}. Is the server running on port 5000?`,
    });
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const envelope = (parsed as { error?: ApiErrorShape } | null)?.error;
    throw new ApiError(res.status, envelope ?? { code: `HTTP_${res.status}`, message: res.statusText || 'Request failed' });
  }
  return parsed as T;
}

/** URL for a file download endpoint that accepts `?token=` (brief PDF, exports). */
export function downloadUrl(path: string, token: string | null, query?: RequestOptions['query']): string {
  return buildUrl(path, { ...(query ?? {}), token: token ?? undefined });
}

/** Human-readable one-liner for any thrown value. */
export function errMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
