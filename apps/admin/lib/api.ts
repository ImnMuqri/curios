/** An error carrying the API's own domain code (the wire code matters more than the status). */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const BASE = process.env.NEXT_PUBLIC_ADMIN_API_URL ?? 'http://localhost:3001';

/**
 * The only way this app talks to `apps/api`. `credentials: 'include'` because
 * the admin cookie is httpOnly; the JSON content type forces a preflight,
 * which with SameSite=Strict and a single permitted origin stands in for a
 * CSRF token. A bodyless mutation still sends `{}` because Fastify rejects a
 * JSON content type with an empty body.
 */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const requestBody = init.body === undefined && method !== 'GET' && method !== 'HEAD' ? '{}' : init.body;

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    body: requestBody,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

  if (response.ok) return (await response.json().catch(() => null)) as T;

  const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  throw new ApiError(
    response.status,
    body?.error?.code ?? 'INTERNAL_ERROR',
    body?.error?.message ?? 'Something failed. Try again.',
  );
}
