/**
 * An error carrying the API's own domain code.
 *
 * The code matters more than the status: `HANDLE_TAKEN` and
 * `HANDLE_TOO_SIMILAR` are both 409 and mean different things to the person
 * typing, and `errorsPlugin` in the API exists precisely so that distinction
 * survives the wire.
 */
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

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * The only way this app talks to `apps/api`.
 *
 * `credentials: 'include'` because the session cookie is httpOnly and does not
 * travel otherwise. The JSON content type because it forces a preflight, which
 * together with SameSite=Lax and a single permitted CORS origin is what stands
 * in for a CSRF token -- see the CSRF section of the build spec, which records
 * that this is an assumption and what would collapse it.
 */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();

  // A bodyless mutation (verify, reject, publish -- none of them take a
  // request payload) must still send a JSON body. Fastify's JSON parser
  // rejects a JSON content type paired with a genuinely empty body:
  // "Body cannot be empty when content-type is set to 'application/json'".
  // Dropping the content type instead would fix that, but the content type
  // is one of three stacked mechanisms standing in for a CSRF token (see the
  // header comment above); removing it here would strip that defence from
  // exactly the three most destructive actions in the product. Two bytes on
  // the wire is the cheaper trade.
  const requestBody = init.body === undefined && method !== 'GET' && method !== 'HEAD' ? '{}' : init.body;

  const response = await fetch(`${BASE}${path}`, {
    ...init,
    body: requestBody,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

  if (response.ok) return (await response.json().catch(() => null)) as T;

  // A proxy or a crash can return HTML. Reading `error.code` off that would
  // throw inside the error path, which is the worst place to throw.
  const body = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | null;

  throw new ApiError(
    response.status,
    body?.error?.code ?? 'INTERNAL_ERROR',
    body?.error?.message ?? 'Something failed. Try again.',
  );
}
