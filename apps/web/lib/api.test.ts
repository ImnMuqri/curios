import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, ApiError } from './api.js';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  // Typed with fetch's real signature, unused params and all: vi.fn() infers
  // its mock's call-args shape from this implementation's own parameter
  // list, and a zero-arg arrow here would make spy.mock.calls[0][1] below an
  // out-of-bounds tuple index at compile time, despite fetch always being
  // called with two arguments at runtime.
  const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('apiFetch', () => {
  it('sends the cookie and a JSON content type', async () => {
    const spy = stubFetch(200, { ok: true });

    await apiFetch('/auth/me');

    const init = spy.mock.calls[0]?.[1] as RequestInit;
    // Both are load-bearing. Without credentials the cookie never travels;
    // without the JSON content type the request stops being one the browser
    // preflights, and the preflight is one of the three things standing in
    // for a CSRF token.
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('raises the domain code, not the status', async () => {
    stubFetch(409, { error: { code: 'HANDLE_TAKEN', message: 'That handle is taken.' } });

    // A screen needs to tell "taken" from "too similar" to say anything
    // useful, and both are 409.
    await expect(apiFetch('/pages', { method: 'POST' })).rejects.toMatchObject({
      code: 'HANDLE_TAKEN',
      message: 'That handle is taken.',
    });
  });

  it('survives a response that is not JSON at all', async () => {
    const spy = vi.fn(async () => new Response('<html>502</html>', { status: 502 }));
    vi.stubGlobal('fetch', spy);

    // A proxy returning HTML is not a domain error and must not crash the
    // screen trying to read `error.code` off a parse failure.
    await expect(apiFetch('/pages')).rejects.toBeInstanceOf(ApiError);
  });
});
