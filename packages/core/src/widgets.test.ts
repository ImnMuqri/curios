import { describe, expect, it } from 'vitest';
import {
  WIDGET_FRAME_ORIGINS,
  WIDGET_NAMES,
  WIDGET_PROVIDERS,
  minWidgetSize,
  appleLookup,
  cardImageOk,
  cardTypeName,
  hasCard,
  widgetOpenUrl,
  parseWidgetLink,
  widgetHeight,
  widgetSrc,
} from './widgets.js';

const refused = (raw: string) => {
  const r = parseWidgetLink(raw);
  expect(r.ok, raw).toBe(false);
  return r;
};

describe('the provider list', () => {
  it('names all eight, each with a display name and a frame origin', () => {
    expect(WIDGET_PROVIDERS).toHaveLength(8);
    expect(WIDGET_NAMES).toEqual({
      SPOTIFY: 'Spotify',
      APPLE_MUSIC: 'Apple Music',
      YOUTUBE: 'YouTube Music',
      SOUNDCLOUD: 'SoundCloud',
      GOOGLE_MAPS: 'Google Maps',
      CALCOM: 'Cal.com',
      CALENDLY: 'Calendly',
      CANVA: 'Canva',
    });
    expect([...WIDGET_FRAME_ORIGINS].sort()).toEqual(
      [
        'https://open.spotify.com',
        'https://embed.music.apple.com',
        'https://www.youtube-nocookie.com',
        'https://w.soundcloud.com',
        'https://www.google.com',
        'https://cal.com',
        'https://calendly.com',
        'https://www.canva.com',
      ].sort(),
    );
  });
});

describe('Spotify', () => {
  it('accepts every type and drops the query', () => {
    expect(parseWidgetLink('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x')).toEqual({
      ok: true,
      provider: 'SPOTIFY',
      embedRef: 'playlist/37i9dQZF1DXcBWIGoYBM5M',
    });
    for (const t of ['track', 'album', 'playlist', 'artist', 'episode', 'show']) {
      expect(parseWidgetLink(`https://open.spotify.com/${t}/abc123`)).toEqual({
        ok: true,
        provider: 'SPOTIFY',
        embedRef: `${t}/abc123`,
      });
    }
  });
  it('accepts a locale prefix', () => {
    expect(parseWidgetLink('https://open.spotify.com/intl-de/track/abc123')).toEqual({
      ok: true,
      provider: 'SPOTIFY',
      embedRef: 'track/abc123',
    });
  });
  it('builds the player address, height and size', () => {
    expect(widgetSrc('SPOTIFY', 'playlist/37i9dQZF1DXcBWIGoYBM5M')).toBe(
      'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M',
    );
    expect(widgetHeight('SPOTIFY', 'track/abc')).toBe(152);
    expect(widgetHeight('SPOTIFY', 'episode/abc')).toBe(152);
    expect(widgetHeight('SPOTIFY', 'playlist/abc')).toBe(352);
    expect(minWidgetSize('SPOTIFY', 'track/abc')).toBe('SMALL');
    expect(minWidgetSize('SPOTIFY', 'episode/abc')).toBe('SMALL');
    for (const t of ['playlist', 'album', 'artist', 'show']) {
      expect(minWidgetSize('SPOTIFY', `${t}/abc`)).toBe('SMALL');
    }
  });
  it('builds a card address from the stored ref, and names the type', () => {
    expect(widgetOpenUrl('SPOTIFY', 'track/abc123')).toBe('https://open.spotify.com/track/abc123');
    expect(() => widgetOpenUrl('SPOTIFY', 'user/abc')).toThrow();
    expect(() => widgetOpenUrl('SPOTIFY', 'track/a"><x')).toThrow();
    expect(() => widgetOpenUrl('YOUTUBE', 'v/abc')).toThrow();
    expect(widgetOpenUrl('APPLE_MUSIC', 'us/album/blinding-lights/1499378108?i=1499378113')).toBe(
      'https://music.apple.com/us/album/blinding-lights/1499378108?i=1499378113',
    );
    expect(() => widgetOpenUrl('APPLE_MUSIC', 'us/album/../x')).toThrow();
    expect(cardTypeName('SPOTIFY', 'track/a')).toBe('Song');
    expect(cardTypeName('SPOTIFY', 'show/a')).toBe('Podcast');
    expect(cardTypeName('SPOTIFY', 'episode/a')).toBe('Episode');
    expect(cardTypeName('SPOTIFY', 'album/a')).toBe('Album');
    expect(cardTypeName('SPOTIFY', 'playlist/a')).toBe('Playlist');
    expect(cardTypeName('SPOTIFY', 'artist/a')).toBe('Artist');
    expect(cardTypeName('SPOTIFY', 'nope/a')).toBe('');
    expect(cardTypeName('APPLE_MUSIC', 'us/song/x/123')).toBe('Song');
    expect(cardTypeName('APPLE_MUSIC', 'us/album/x/123?i=456')).toBe('Song');
    expect(cardTypeName('APPLE_MUSIC', 'us/album/x/123')).toBe('Album');
    expect(cardTypeName('APPLE_MUSIC', 'us/playlist/x/pl.abc')).toBe('Playlist');
    expect(cardTypeName('APPLE_MUSIC', 'us/artist/x/123')).toBe('Artist');
    expect(cardTypeName('YOUTUBE', 'v/abc')).toBe('');
  });
  it('picks the Apple lookup id: the ?i= song, else a numeric last segment, never a playlist', () => {
    expect(appleLookup('us/album/x/123?i=456')).toEqual({ id: '456', country: 'us' });
    expect(appleLookup('us/album/x/123')).toEqual({ id: '123', country: 'us' });
    expect(appleLookup('gb/artist/x/789')).toEqual({ id: '789', country: 'gb' });
    expect(appleLookup('us/playlist/x/pl.abc')).toBeNull();
  });
  it("accepts a cover only on the service's own https image host, and not over-long", () => {
    expect(cardImageOk('SPOTIFY', 'https://i.scdn.co/image/a')).toBe(true);
    expect(cardImageOk('SPOTIFY', 'https://x.spotifycdn.com/a')).toBe(true);
    expect(cardImageOk('SPOTIFY', 'https://is1-ssl.mzstatic.com/a')).toBe(false);
    expect(cardImageOk('APPLE_MUSIC', 'https://is1-ssl.mzstatic.com/a')).toBe(true);
    expect(cardImageOk('APPLE_MUSIC', 'https://i.scdn.co/a')).toBe(false);
    expect(cardImageOk('APPLE_MUSIC', 'http://is1-ssl.mzstatic.com/a')).toBe(false);
    expect(cardImageOk('APPLE_MUSIC', 'https://evil.example/mzstatic.com')).toBe(false);
    expect(cardImageOk('SPOTIFY', 'https://i.scdn.co/' + 'x'.repeat(2100))).toBe(false);
    expect(cardImageOk('YOUTUBE', 'https://i.scdn.co/a')).toBe(false);
    expect(cardImageOk('SPOTIFY', null)).toBe(false);
  });
  it('a card fits a small tile for Spotify and Apple Music only', () => {
    expect(minWidgetSize('APPLE_MUSIC', 'us/album/x/123')).toBe('SMALL');
    expect(minWidgetSize('APPLE_MUSIC', 'us/playlist/x/pl.abc')).toBe('SMALL');
    expect(hasCard('SPOTIFY')).toBe(true);
    expect(hasCard('YOUTUBE')).toBe(false);
  });
  it('refuses a user page, a bad id and a lookalike host', () => {
    const r = refused('https://open.spotify.com/user/x');
    expect(r).toMatchObject({ ok: false, short: false });
    expect((r as { message: string }).message).toMatch(/Spotify/);
    refused('https://open.spotify.com/track/ab"onload=1');
    refused('https://open.spotify.com/track/ab.cd');
    refused('https://open.spotify.com/track/');
    refused('https://evil.example/open.spotify.com/track/1');
    refused('https://open.spotify.com.evil.example/track/1');
    refused('https://notopen.spotify.com/track/1');
  });
  it('flags a short link', () => {
    expect(parseWidgetLink('https://spotify.link/AbC123')).toEqual({ ok: false, short: true, provider: 'SPOTIFY' });
  });
});

describe('Apple Music', () => {
  it('keeps the path and the song id', () => {
    expect(parseWidgetLink('https://music.apple.com/my/album/name/123?i=456')).toEqual({
      ok: true,
      provider: 'APPLE_MUSIC',
      embedRef: 'my/album/name/123?i=456',
    });
    expect(widgetSrc('APPLE_MUSIC', 'my/album/name/123?i=456')).toBe(
      'https://embed.music.apple.com/my/album/name/123?i=456',
    );
  });
  it('accepts a playlist and drops other query parameters', () => {
    expect(parseWidgetLink('https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb?l=en')).toEqual({
      ok: true,
      provider: 'APPLE_MUSIC',
      embedRef: 'us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb',
    });
  });
  it('encodes a non-ascii slug and never passes raw characters', () => {
    const r = parseWidgetLink('https://music.apple.com/jp/album/%E3%81%82/123');
    expect(r).toEqual({ ok: true, provider: 'APPLE_MUSIC', embedRef: 'jp/album/%E3%81%82/123' });
    expect(widgetSrc('APPLE_MUSIC', 'jp/album/%E3%81%82/123')).toBe(
      'https://embed.music.apple.com/jp/album/%E3%81%82/123',
    );
  });
  it('heights and size', () => {
    expect(widgetHeight('APPLE_MUSIC', 'us/song/x/123')).toBe(175);
    expect(widgetHeight('APPLE_MUSIC', 'us/album/x/123')).toBe(450);
    // Apple's "Share song" link is the album with ?i=<song>: the embed draws one song, 175 high.
    expect(widgetHeight('APPLE_MUSIC', 'my/album/iqro/1440833098?i=1440833107')).toBe(175);
    expect(minWidgetSize('APPLE_MUSIC', 'us/album/x/123')).toBe('SMALL');
  });
  it('refuses bad shapes and traversal', () => {
    refused('https://music.apple.com/us/station/x/ra.1');
    refused('https://music.apple.com/us');
    refused('https://music.apple.com/us/album/%2E%2E/123');
    refused('https://music.apple.com/us/album/x%2Fy/123');
    refused('https://music.apple.com/us/album/x/12a');
    refused('https://music.apple.com/us/album/x/123?i=4"5');
    refused('https://embed.music.apple.com/us/album/x/123');
  });
});

describe('YouTube Music', () => {
  it('prefers the video over the list', () => {
    expect(parseWidgetLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x')).toEqual({
      ok: true,
      provider: 'YOUTUBE',
      embedRef: 'v/dQw4w9WgXcQ',
    });
  });
  it('accepts the other shapes', () => {
    expect(parseWidgetLink('https://music.youtube.com/playlist?list=PL123')).toEqual({
      ok: true,
      provider: 'YOUTUBE',
      embedRef: 'list/PL123',
    });
    expect(parseWidgetLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({ embedRef: 'v/dQw4w9WgXcQ' });
    expect(parseWidgetLink('https://youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({ embedRef: 'v/dQw4w9WgXcQ' });
    expect(parseWidgetLink('https://youtu.be/dQw4w9WgXcQ?t=5')).toMatchObject({ embedRef: 'v/dQw4w9WgXcQ' });
    expect(parseWidgetLink('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toMatchObject({ embedRef: 'v/dQw4w9WgXcQ' });
    expect(parseWidgetLink('https://www.youtube.com/playlist?list=PL123')).toMatchObject({ embedRef: 'list/PL123' });
  });
  it('builds the no-cookie address', () => {
    expect(widgetSrc('YOUTUBE', 'v/dQw4w9WgXcQ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(widgetSrc('YOUTUBE', 'list/PL123')).toBe('https://www.youtube-nocookie.com/embed/videoseries?list=PL123');
    expect(widgetHeight('YOUTUBE', 'v/dQw4w9WgXcQ')).toBe(0);
    expect(minWidgetSize('YOUTUBE', 'v/dQw4w9WgXcQ')).toBe('WIDE');
  });
  it('refuses a bad id, a channel page and a lookalike host', () => {
    refused('https://www.youtube.com/watch?v=a<b');
    refused('https://www.youtube.com/channel/UC123');
    refused('https://www.youtube.com/watch');
    refused('https://youtube.com.evil.example/watch?v=abc');
    refused('https://m.youtube.com.evil.example/watch?v=abc');
  });
});

describe('SoundCloud', () => {
  it('keeps the canonical address of a track and a set', () => {
    expect(parseWidgetLink('https://soundcloud.com/some-artist/a_track?si=abc&utm_source=x')).toEqual({
      ok: true,
      provider: 'SOUNDCLOUD',
      embedRef: 'https://soundcloud.com/some-artist/a_track',
    });
    expect(parseWidgetLink('https://soundcloud.com/some-artist/sets/an-album')).toEqual({
      ok: true,
      provider: 'SOUNDCLOUD',
      embedRef: 'https://soundcloud.com/some-artist/sets/an-album',
    });
  });
  it('builds the player address, height and size', () => {
    expect(widgetSrc('SOUNDCLOUD', 'https://soundcloud.com/some-artist/a_track')).toBe(
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fsome-artist%2Fa_track',
    );
    expect(widgetHeight('SOUNDCLOUD', 'https://soundcloud.com/a/b')).toBe(166);
    expect(widgetHeight('SOUNDCLOUD', 'https://soundcloud.com/a/sets/b')).toBe(450);
    expect(minWidgetSize('SOUNDCLOUD', 'https://soundcloud.com/a/b')).toBe('WIDE');
  });
  it('flags a short link and refuses a profile or odd characters', () => {
    expect(parseWidgetLink('https://on.soundcloud.com/abc123')).toEqual({ ok: false, short: true, provider: 'SOUNDCLOUD' });
    refused('https://soundcloud.com/some-artist');
    refused('https://soundcloud.com/a/b%22c');
    refused('https://soundcloud.com/a/b/c/d');
  });
  it('still draws a stored playlist and a stored track', () => {
    expect(widgetSrc('SOUNDCLOUD', 'https://soundcloud.com/a/sets/b')).toContain('https://w.soundcloud.com/');
    expect(widgetSrc('SOUNDCLOUD', 'https://soundcloud.com/a/b')).toContain('https://w.soundcloud.com/');
    expect(() => widgetSrc('SOUNDCLOUD', 'https://soundcloud.com/a/likes')).toThrow();
  });
  it("refuses an artist's own pages, which are not a track", () => {
    for (const page of ['likes', 'reposts', 'albums', 'tracks', 'popular-tracks', 'followers', 'following', 'comments', 'sets', 'Likes']) {
      refused(`https://soundcloud.com/some-artist/${page}`);
    }
    expect(parseWidgetLink('https://soundcloud.com/some-artist/my-likes-mix')).toMatchObject({ ok: true });
  });
});

describe('Google Maps', () => {
  it('reads the place name from /maps/place/', () => {
    expect(parseWidgetLink('https://www.google.com/maps/place/Menara+Kuala+Lumpur/@3.15,101.7,17z/data=!3m1')).toEqual({
      ok: true,
      provider: 'GOOGLE_MAPS',
      embedRef: 'Menara Kuala Lumpur',
    });
    expect(parseWidgetLink('https://google.com/maps/place/Caf%C3%A9+%26+Bar/')).toMatchObject({
      embedRef: 'Café & Bar',
    });
  });
  it('reads the q parameter', () => {
    expect(parseWidgetLink('https://maps.google.com/?q=Petronas+Twin+Towers')).toEqual({
      ok: true,
      provider: 'GOOGLE_MAPS',
      embedRef: 'Petronas Twin Towers',
    });
    expect(parseWidgetLink('https://www.google.com/maps?q=KLCC')).toMatchObject({ embedRef: 'KLCC' });
  });
  it('encodes the place into the player address', () => {
    expect(widgetSrc('GOOGLE_MAPS', 'Café & Bar "x"')).toBe(
      'https://www.google.com/maps?q=Caf%C3%A9%20%26%20Bar%20%22x%22&output=embed',
    );
    expect(widgetSrc('GOOGLE_MAPS', 'a&output=evil#x')).toBe(
      'https://www.google.com/maps?q=a%26output%3Devil%23x&output=embed',
    );
    expect(widgetHeight('GOOGLE_MAPS', 'KLCC')).toBe(300);
    expect(minWidgetSize('GOOGLE_MAPS', 'KLCC')).toBe('WIDE');
  });
  it('flags short links and refuses directions', () => {
    expect(parseWidgetLink('https://maps.app.goo.gl/abc')).toEqual({ ok: false, short: true, provider: 'GOOGLE_MAPS' });
    expect(parseWidgetLink('https://goo.gl/maps/abc')).toEqual({ ok: false, short: true, provider: 'GOOGLE_MAPS' });
    const r = refused('https://www.google.com/maps/dir/KLCC/KL+Sentral');
    expect(r).toMatchObject({ short: false });
    expect((r as { message: string }).message).toMatch(/Google Maps/);
    refused('https://www.google.com/search?q=cafe');
    refused('https://goo.gl/abc');
  });
});

describe('Cal.com', () => {
  it('accepts a user with or without an event', () => {
    expect(parseWidgetLink('https://cal.com/nadia/30min?month=2026-12')).toEqual({
      ok: true,
      provider: 'CALCOM',
      embedRef: 'nadia/30min',
    });
    expect(parseWidgetLink('https://cal.com/nadia')).toMatchObject({ embedRef: 'nadia' });
    expect(widgetSrc('CALCOM', 'nadia/30min')).toBe('https://cal.com/nadia/30min?embed=true');
    expect(widgetSrc('CALCOM', 'nadia')).toBe('https://cal.com/nadia?embed=true');
    expect(widgetHeight('CALCOM', 'nadia/30min')).toBe(640);
    expect(minWidgetSize('CALCOM', 'nadia')).toBe('WIDE');
  });
  it('refuses no user, extra depth and odd characters', () => {
    refused('https://cal.com/');
    refused('https://cal.com/a/b/c');
    refused('https://cal.com/a b/c');
    refused('https://cal.com/a/b%3Fx');
  });
});

describe('Calendly', () => {
  it('accepts a user with or without an event', () => {
    expect(parseWidgetLink('https://calendly.com/nadia/intro-call?back=1')).toEqual({
      ok: true,
      provider: 'CALENDLY',
      embedRef: 'nadia/intro-call',
    });
    expect(parseWidgetLink('https://calendly.com/nadia')).toMatchObject({ embedRef: 'nadia' });
    expect(widgetSrc('CALENDLY', 'nadia/intro-call')).toBe(
      'https://calendly.com/nadia/intro-call?embed_type=Inline&hide_gdpr_banner=1',
    );
    expect(widgetSrc('CALENDLY', 'nadia')).toBe('https://calendly.com/nadia?embed_type=Inline&hide_gdpr_banner=1');
    expect(widgetHeight('CALENDLY', 'nadia')).toBe(640);
    expect(minWidgetSize('CALENDLY', 'nadia')).toBe('WIDE');
  });
  it('refuses no user', () => {
    const r = refused('https://calendly.com');
    expect(r).toMatchObject({ short: false });
    expect((r as { message: string }).message).toMatch(/Calendly/);
    refused('https://calendly.com/');
  });
});

describe('Canva', () => {
  it('accepts a view-only design', () => {
    expect(parseWidgetLink('https://www.canva.com/design/DAF123abc_-/k3y-XYZ/view?utm_content=x')).toEqual({
      ok: true,
      provider: 'CANVA',
      embedRef: 'DAF123abc_-/k3y-XYZ',
    });
    expect(parseWidgetLink('https://canva.com/design/DAF123/key/view')).toMatchObject({ embedRef: 'DAF123/key' });
    expect(widgetSrc('CANVA', 'DAF123/key')).toBe('https://www.canva.com/design/DAF123/key/view?embed');
    expect(widgetHeight('CANVA', 'DAF123/key')).toBe(0);
    expect(minWidgetSize('CANVA', 'DAF123/key')).toBe('WIDE');
  });
  it('refuses an edit link', () => {
    const r = refused('https://www.canva.com/design/DAF123/key/edit');
    expect(r).toMatchObject({ short: false });
    expect((r as { message: string }).message).toMatch(/Canva/);
    refused('https://www.canva.com/design/DAF123/key');
    refused('https://www.canva.com/design/DA"F/key/view');
  });
});

describe('what is never accepted', () => {
  it('refuses non-https, junk and lookalike paths', () => {
    refused('javascript:alert(1)');
    refused('http://open.spotify.com/track/1');
    refused('data:text/html,<script>1</script>');
    refused('not a url');
    refused('');
    refused('https://evil.example/open.spotify.com/track/1');
    refused('https://example.com/');
    refused('https://user:pw@open.spotify.com/track/1');
    refused('https://open.spotify.com:8443/track/1');
    const r = refused('https://example.com/');
    expect((r as { message: string }).message).toMatch(/Spotify/);
  });
  it('widgetSrc starts with an allowed origin for every accepted shape', () => {
    const links = [
      'https://open.spotify.com/track/abc',
      'https://music.apple.com/us/album/x/123',
      'https://music.youtube.com/watch?v=abc',
      'https://soundcloud.com/a/b',
      'https://www.google.com/maps/place/KLCC',
      'https://cal.com/a/b',
      'https://calendly.com/a/b',
      'https://www.canva.com/design/a/b/view',
    ];
    for (const l of links) {
      const r = parseWidgetLink(l);
      expect(r.ok, l).toBe(true);
      if (!r.ok) continue;
      const src = widgetSrc(r.provider, r.embedRef);
      expect(WIDGET_FRAME_ORIGINS.some((o) => src.startsWith(o + '/')), src).toBe(true);
    }
  });
  it('widgetSrc refuses a ref that was not made by the parser', () => {
    expect(() => widgetSrc('SPOTIFY', 'track/a"><script>')).toThrow();
    expect(() => widgetSrc('SPOTIFY', 'user/abc')).toThrow();
    expect(() => widgetSrc('YOUTUBE', 'v/a&b=c')).toThrow();
    expect(() => widgetSrc('CALCOM', '../x')).toThrow();
    expect(() => widgetSrc('CANVA', 'a/b/../c')).toThrow();
    expect(() => widgetSrc('SOUNDCLOUD', 'https://evil.example/a/b')).toThrow();
    expect(() => widgetSrc('APPLE_MUSIC', 'us/album/../x/1')).toThrow();
    expect(() => widgetSrc('GOOGLE_MAPS', '')).toThrow();
  });
});
