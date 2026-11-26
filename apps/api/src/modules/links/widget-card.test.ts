import { describe, expect, it, vi } from 'vitest';
import { fetchWidgetCard } from './widget-card.js';

const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), { status: 200, ...init });
const stub = (fn: (...a: unknown[]) => Promise<Response>) => ({ fetch: vi.fn(fn) as unknown as typeof fetch });
const nulls = { title: null, image: null };

describe('fetchWidgetCard for Spotify', () => {
  it('asks the oEmbed endpoint once for the canonical address, without following redirects', async () => {
    const deps = stub(async () => json({ title: 'Blinding Lights', thumbnail_url: 'https://i.scdn.co/image/abc' }));
    const card = await fetchWidgetCard('SPOTIFY', 'track/0VjIjW4GlUZAMYd2vXMi3b', deps);
    expect(card).toEqual({ title: 'Blinding Lights', image: 'https://i.scdn.co/image/abc' });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (deps.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://open.spotify.com/oembed?url=' + encodeURIComponent('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b'));
    expect(init).toEqual(expect.objectContaining({ redirect: 'manual' }));
  });

  it('trims the title and caps it at 200 characters', async () => {
    const long = 'x'.repeat(300);
    const a = await fetchWidgetCard('SPOTIFY', 'track/a', stub(async () => json({ title: `  ${long}  `, thumbnail_url: null })));
    expect(a.title).toBe('x'.repeat(200));
    const b = await fetchWidgetCard('SPOTIFY', 'track/a', stub(async () => json({ title: '   ', thumbnail_url: null })));
    expect(b.title).toBeNull();
  });

  it('keeps the cover only on https and a Spotify image host', async () => {
    const image = async (u: string) => (await fetchWidgetCard('SPOTIFY', 'track/a', stub(async () => json({ title: 't', thumbnail_url: u })))).image;
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
    expect(await fetchWidgetCard('SPOTIFY', 'track/a', stub(async () => { throw new Error('network'); }))).toEqual(nulls);
    expect(await fetchWidgetCard('SPOTIFY', 'track/a', stub(async () => { throw new DOMException('timed out', 'TimeoutError'); }))).toEqual(nulls);
    expect(await fetchWidgetCard('SPOTIFY', 'track/a', stub(async () => new Response('no', { status: 404 })))).toEqual(nulls);
    expect(await fetchWidgetCard('SPOTIFY', 'track/a', stub(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } })))).toEqual(nulls);
    expect(await fetchWidgetCard('SPOTIFY', 'track/a', stub(async () => new Response('<html>', { status: 200 })))).toEqual(nulls);
    expect(await fetchWidgetCard('SPOTIFY', 'track/a', stub(async () => json([1, 2])))).toEqual(nulls);
    expect(await fetchWidgetCard('SPOTIFY', 'track/a', stub(async () => json({ title: 5, thumbnail_url: {} })))).toEqual(nulls);
  });

  it('refuses a body over the size cap', async () => {
    const big = JSON.stringify({ title: 't', pad: 'x'.repeat(200_000) });
    expect(await fetchWidgetCard('SPOTIFY', 'track/a', stub(async () => new Response(big, { status: 200 })))).toEqual(nulls);
  });

  it('never asks about a ref that is not a Spotify one', async () => {
    const deps = stub(async () => json({ title: 't' }));
    expect(await fetchWidgetCard('SPOTIFY', '../evil', deps)).toEqual(nulls);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});

describe('fetchWidgetCard for Apple Music', () => {
  const song = { trackName: 'Blinding Lights', collectionName: 'After Hours', artistName: 'The Weeknd', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg' };
  const lookup = (results: unknown[]) => stub(async () => json({ resultCount: results.length, results }));
  const calls = (deps: { fetch: typeof fetch }) => (deps.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;

  it('looks up the ?i= song, with the country, and takes the track name and a 300px cover', async () => {
    const deps = lookup([song]);
    expect(await fetchWidgetCard('APPLE_MUSIC', 'us/album/after-hours/1499378108?i=1499378113', deps)).toEqual({
      title: 'Blinding Lights',
      image: 'https://is1-ssl.mzstatic.com/image/thumb/x/300x300bb.jpg',
    });
    expect(calls(deps)).toHaveLength(1);
    expect(calls(deps)[0]![0]).toBe('https://itunes.apple.com/lookup?id=1499378113&country=us');
    expect(calls(deps)[0]![1]).toEqual(expect.objectContaining({ redirect: 'manual' }));
  });

  it('names an album by its collection and an artist by its name', async () => {
    const album = await fetchWidgetCard('APPLE_MUSIC', 'us/album/after-hours/1499378108', lookup([{ collectionName: 'After Hours', artistName: 'The Weeknd', artworkUrl100: song.artworkUrl100 }]));
    expect(album.title).toBe('After Hours');
    const artist = await fetchWidgetCard('APPLE_MUSIC', 'us/artist/the-weeknd/479756766', lookup([{ artistName: 'The Weeknd' }]));
    expect(artist).toEqual({ title: 'The Weeknd', image: null });
  });

  it('keeps a cover only on https and mzstatic.com', async () => {
    const image = async (u: string) => (await fetchWidgetCard('APPLE_MUSIC', 'us/song/x/1', lookup([{ trackName: 't', artworkUrl100: u }]))).image;
    expect(await image('http://a1.mzstatic.com/100x100.jpg')).toBeNull();
    expect(await image('https://evil.example/mzstatic.com/100x100.jpg')).toBeNull();
    expect(await image('https://mzstatic.com.evil.example/100x100.jpg')).toBeNull();
  });

  it('saves nulls for a playlist (no lookup is made), no results, and any failure', async () => {
    const none = stub(async () => json({ results: [] }));
    expect(await fetchWidgetCard('APPLE_MUSIC', 'us/playlist/x/pl.abc', none)).toEqual(nulls);
    expect(none.fetch).not.toHaveBeenCalled();
    expect(await fetchWidgetCard('APPLE_MUSIC', 'us/song/x/1', none)).toEqual(nulls);
    expect(await fetchWidgetCard('APPLE_MUSIC', 'us/song/x/1', stub(async () => { throw new Error('network'); }))).toEqual(nulls);
    expect(await fetchWidgetCard('APPLE_MUSIC', 'us/song/x/1', stub(async () => new Response('x', { status: 500 })))).toEqual(nulls);
    expect(await fetchWidgetCard('APPLE_MUSIC', 'us/song/x/1', stub(async () => new Response('{', { status: 200 })))).toEqual(nulls);
    expect(await fetchWidgetCard('APPLE_MUSIC', 'us/song/x/1', stub(async () => json({ results: 'no' })))).toEqual(nulls);
    expect(await fetchWidgetCard('APPLE_MUSIC', 'us/song/x/1', stub(async () => new Response(JSON.stringify({ results: [{ trackName: 'x'.repeat(200_000) }] }))))).toEqual(nulls);
  });

  it('asks nothing for a provider with no card', async () => {
    const deps = stub(async () => json({}));
    expect(await fetchWidgetCard('YOUTUBE', 'v/abc', deps)).toEqual(nulls);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});
