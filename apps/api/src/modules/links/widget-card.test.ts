import { describe, expect, it, vi } from 'vitest';
import { fetchSpotifyCard } from './spotify-card.js';

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: 200, ...init });
const stub = (fn: (...a: unknown[]) => Promise<Response>) => ({ fetch: vi.fn(fn) as unknown as typeof fetch });
const nulls = { title: null, image: null };

describe('fetchSpotifyCard', () => {
  it('asks the oEmbed endpoint once for the canonical address, without following redirects', async () => {
    const deps = stub(async () => json({ title: 'Blinding Lights', thumbnail_url: 'https://i.scdn.co/image/abc' }));
    const card = await fetchSpotifyCard('track/0VjIjW4GlUZAMYd2vXMi3b', deps);
    expect(card).toEqual({ title: 'Blinding Lights', image: 'https://i.scdn.co/image/abc' });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (deps.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://open.spotify.com/oembed?url=' + encodeURIComponent('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b'));
    expect(init).toEqual(expect.objectContaining({ redirect: 'manual' }));
  });

  it('trims the title and caps it at 200 characters', async () => {
    const long = 'x'.repeat(300);
    const a = await fetchSpotifyCard('track/a', stub(async () => json({ title: `  ${long}  `, thumbnail_url: null })));
    expect(a.title).toBe('x'.repeat(200));
    const b = await fetchSpotifyCard('track/a', stub(async () => json({ title: '   ', thumbnail_url: null })));
    expect(b.title).toBeNull();
  });

  it('keeps the cover only on https and a Spotify image host', async () => {
    const image = async (u: string) => (await fetchSpotifyCard('track/a', stub(async () => json({ title: 't', thumbnail_url: u })))).image;
    expect(await image('https://i.scdn.co/image/x')).toBe('https://i.scdn.co/image/x');
    expect(await image('https://mosaic.scdn.co/640/x')).toBe('https://mosaic.scdn.co/640/x');
    expect(await image('https://image-cdn-ak.spotifycdn.com/image/x')).toBe('https://image-cdn-ak.spotifycdn.com/image/x');
    expect(await image('http://i.scdn.co/image/x')).toBeNull();
    expect(await image('https://evil.example/i.scdn.co')).toBeNull();
    expect(await image('https://scdn.co.evil.example/x')).toBeNull();
    expect(await image('https://notscdn.co/x')).toBeNull();
    expect(await image('https://user:pw@i.scdn.co/x')).toBeNull();
    expect(await image('javascript:alert(1)')).toBeNull();
    expect(await image('not a url')).toBeNull();
  });

  it('gives nulls for a network error, a timeout, a non-200, a redirect and bad JSON', async () => {
    expect(await fetchSpotifyCard('track/a', stub(async () => { throw new Error('network'); }))).toEqual(nulls);
    expect(await fetchSpotifyCard('track/a', stub(async () => { throw new DOMException('timed out', 'TimeoutError'); }))).toEqual(nulls);
    expect(await fetchSpotifyCard('track/a', stub(async () => new Response('no', { status: 404 })))).toEqual(nulls);
    expect(await fetchSpotifyCard('track/a', stub(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } })))).toEqual(nulls);
    expect(await fetchSpotifyCard('track/a', stub(async () => new Response('<html>', { status: 200 })))).toEqual(nulls);
    expect(await fetchSpotifyCard('track/a', stub(async () => json([1, 2])))).toEqual(nulls);
    expect(await fetchSpotifyCard('track/a', stub(async () => json({ title: 5, thumbnail_url: {} })))).toEqual(nulls);
  });

  it('refuses a body over the size cap', async () => {
    const big = JSON.stringify({ title: 't', pad: 'x'.repeat(200_000) });
    expect(await fetchSpotifyCard('track/a', stub(async () => new Response(big, { status: 200 })))).toEqual(nulls);
  });

  it('never asks about a ref that is not a Spotify one', async () => {
    const deps = stub(async () => json({ title: 't' }));
    expect(await fetchSpotifyCard('../evil', deps)).toEqual(nulls);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
