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

  it('keeps the whole error body, for a route that sends more than the error', async () => {
    stubFetch(409, { error: { code: 'PRICES_CHANGED', message: 'Prices changed.' }, items: [{ id: 'cake' }] });
    await expect(apiFetch('/store/nadia/orders', { method: 'POST' })).rejects.toMatchObject({
      code: 'PRICES_CHANGED',
      body: { items: [{ id: 'cake' }] },
    });
  });

  it('survives a response that is not JSON at all', async () => {
    const spy = vi.fn(async () => new Response('<html>502</html>', { status: 502 }));
    vi.stubGlobal('fetch', spy);

    // A proxy returning HTML is not a domain error and must not crash the
    // screen trying to read `error.code` off a parse failure.
    await expect(apiFetch('/pages')).rejects.toBeInstanceOf(ApiError);
  });

  it('sends a JSON body on a bodyless mutation, not just the content type', async () => {
    const spy = stubFetch(200, { status: 'verified' });

    // POST /facts/:id/verify and POST /facts/:id/reject are called with no
    // second argument at all -- exactly what Accept and Reject do. Fastify
    // 400s a JSON content type paired with a truly empty body, so the
    // content type alone is not enough; the body must actually be there.
    await apiFetch('/facts/1/verify', { method: 'POST' });

    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe('{}');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('leaves a caller-supplied body untouched', async () => {
    const spy = stubFetch(200, { ok: true });

    await apiFetch('/pages', { method: 'POST', body: JSON.stringify({ handle: 'kuih' }) });

    const init = spy.mock.calls[0]?.[1] as RequestInit;
    // The synthetic '{}' must never clobber a real payload.
    expect(init.body).toBe(JSON.stringify({ handle: 'kuih' }));
  });

  it('sends no body at all on a GET', async () => {
    const spy = stubFetch(200, { ok: true });

    await apiFetch('/auth/me');

    // A GET with a body is a spec violation some runtimes reject outright --
    // the bodyless-mutation fix must not turn every GET into one too.
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeUndefined();
  });
});
