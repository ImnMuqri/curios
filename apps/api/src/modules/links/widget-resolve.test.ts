import { describe, expect, it, vi } from 'vitest';
import { resolveShortLink } from './widget-resolve.js';

const ok = async () => undefined;

describe('resolveShortLink', () => {
  it('guards the host, fetches once without following, and returns the Location', async () => {
    const guard = vi.fn(ok);
    const fetchStub = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://open.spotify.com/track/abc' } }));

    const result = await resolveShortLink('https://spotify.link/xyz', { fetch: fetchStub, guard });

    expect(result).toBe('https://open.spotify.com/track/abc');
    expect(guard).toHaveBeenCalledWith('spotify.link');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]).toEqual(['https://spotify.link/xyz', expect.objectContaining({ redirect: 'manual' })]);
  });

  it('cancels the redirect body after reading the Location, and survives a body that will not cancel', async () => {
    const cancel = vi.fn(async () => undefined);
    const stub = vi.fn(async () => ({ headers: new Headers({ location: 'https://open.spotify.com/track/abc' }), body: { cancel } }));
    expect(await resolveShortLink('https://spotify.link/xyz', { fetch: stub as unknown as typeof fetch, guard: ok })).toBe('https://open.spotify.com/track/abc');
    expect(cancel).toHaveBeenCalledTimes(1);

    const stubborn = vi.fn(async () => ({ headers: new Headers({ location: '/x' }), body: { cancel: async () => { throw new Error('locked'); } } }));
    expect(await resolveShortLink('https://spotify.link/xyz', { fetch: stubborn as unknown as typeof fetch, guard: ok })).toBe('https://spotify.link/x');
  });

  it('returns null and never fetches when the guard refuses the host', async () => {
    const guard = async () => {
      throw new Error('private address');
    };
    const fetchStub = vi.fn();

    expect(await resolveShortLink('https://spotify.link/xyz', { fetch: fetchStub, guard })).toBeNull();
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('returns null when there is no Location, or the fetch fails', async () => {
    const noLocation = vi.fn(async () => new Response('hi', { status: 200 }));
    expect(await resolveShortLink('https://spotify.link/a', { fetch: noLocation, guard: ok })).toBeNull();

    const boom = vi.fn(async () => {
      throw new Error('network');
    });
    expect(await resolveShortLink('https://spotify.link/a', { fetch: boom, guard: ok })).toBeNull();
  });

  it('resolves a relative Location against the short link', async () => {
    const fetchStub = vi.fn(async () => new Response(null, { status: 301, headers: { location: '/maps/place/Cafe' } }));
    expect(await resolveShortLink('https://goo.gl/maps/x', { fetch: fetchStub, guard: ok })).toBe(
      'https://goo.gl/maps/place/Cafe',
    );
  });
});
