/**
 * Widgets: an owner pastes a share link and we decide whether it can become an embedded player.
 *
 * `parseWidgetLink` turns a pasted link into a stored `{ provider, embedRef }`. `widgetSrc` turns a stored
 * pair back into the player's iframe address. The address is only ever built here, from the stored pair,
 * never from what the owner typed, and `widgetSrc` re-checks the ref so a bad stored value throws instead
 * of reaching an iframe. Only https links on exact hostnames are accepted.
 */
import type { TileSize } from './bento.js';

export const WIDGET_PROVIDERS = [
  'SPOTIFY',
  'APPLE_MUSIC',
  'YOUTUBE',
  'SOUNDCLOUD',
  'GOOGLE_MAPS',
  'CALCOM',
  'CALENDLY',
  'CANVA',
] as const;
export type WidgetProvider = (typeof WIDGET_PROVIDERS)[number];
/** A link row is a plain link or a widget. */
export type LinkKind = 'LINK' | 'WIDGET';

export const WIDGET_NAMES: Record<WidgetProvider, string> = {
  SPOTIFY: 'Spotify',
  APPLE_MUSIC: 'Apple Music',
  YOUTUBE: 'YouTube Music',
  SOUNDCLOUD: 'SoundCloud',
  GOOGLE_MAPS: 'Google Maps',
  CALCOM: 'Cal.com',
  CALENDLY: 'Calendly',
  CANVA: 'Canva',
};

/** Where each player is drawn from: exactly the page's CSP `frame-src`. */
export const WIDGET_FRAME_ORIGINS: readonly string[] = [
  'https://open.spotify.com',
  'https://embed.music.apple.com',
  'https://www.youtube-nocookie.com',
  'https://w.soundcloud.com',
  'https://www.google.com',
  'https://cal.com',
  'https://calendly.com',
  'https://www.canva.com',
];

export type WidgetParse =
  | { ok: true; provider: WidgetProvider; embedRef: string }
  | { ok: false; short: true; provider: WidgetProvider }
  | { ok: false; short: false; message: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const PLACE_MAX = 200;

const MESSAGES: Record<WidgetProvider, string> = {
  SPOTIFY: 'Paste a Spotify link to a song, album, playlist, artist or podcast.',
  APPLE_MUSIC: 'Paste an Apple Music link to a song, album, playlist or artist.',
  YOUTUBE: 'Paste a YouTube or YouTube Music link to a video or playlist.',
  SOUNDCLOUD: 'Paste a SoundCloud link to a track or playlist.',
  GOOGLE_MAPS: 'Paste a Google Maps link to a place, not directions.',
  CALCOM: 'Paste your Cal.com booking link, like cal.com/yourname.',
  CALENDLY: 'Paste your Calendly booking link, like calendly.com/yourname.',
  CANVA: 'Paste a Canva link to a design shared as view only, ending in /view.',
};
const GENERIC =
  'Paste a link from Spotify, Apple Music, YouTube Music, SoundCloud, Google Maps, Cal.com, Calendly or Canva.';

const SPOTIFY_TYPES = ['track', 'album', 'playlist', 'artist', 'episode', 'show'];
const APPLE_TYPES = ['album', 'playlist', 'song', 'artist'];
const APPLE_CC = /^[a-z]{2}$/;
const APPLE_LAST = /^(\d+|pl\.[A-Za-z0-9-]+)$/;
const SOUNDCLOUD_CANON = /^https:\/\/soundcloud\.com\/[A-Za-z0-9_-]+\/(sets\/)?[A-Za-z0-9_-]+$/;

const hasControl = (s: string) => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
};

function segments(pathname: string): string[] {
  return pathname.split('/').filter((s) => s !== '');
}

/** Decode one path segment; null when it is malformed or could escape its place in the path. */
function decodeSegment(seg: string): string | null {
  let d: string;
  try {
    d = decodeURIComponent(seg);
  } catch {
    return null;
  }
  if (d === '' || d === '.' || d === '..' || d.includes('/') || d.includes('\\') || hasControl(d)) return null;
  return d;
}

/** The Apple Music ref in its one canonical spelling, or null when it is not a valid path. */
function canonicalApple(ref: string): string | null {
  const [path, query, ...rest] = ref.split('?');
  if (rest.length > 0 || path === undefined) return null;
  const parts = path.split('/');
  if (parts.length < 3) return null;
  const [cc, type, ...tail] = parts as [string, string, ...string[]];
  if (!APPLE_CC.test(cc) || !APPLE_TYPES.includes(type)) return null;
  const out: string[] = [];
  for (const t of tail) {
    const d = decodeSegment(t);
    if (d === null) return null;
    out.push(encodeURIComponent(d));
  }
  const last = out[out.length - 1];
  if (last === undefined || !APPLE_LAST.test(last)) return null;
  let q = '';
  if (query !== undefined) {
    if (!/^i=\d{1,20}$/.test(query)) return null;
    q = `?${query}`;
  }
  return `${cc}/${type}/${out.join('/')}${q}`;
}

function placeOk(p: string): boolean {
  return p.trim() === p && p.length > 0 && p.length <= PLACE_MAX && !hasControl(p);
}

/** Is `ref` exactly what `parseWidgetLink` would have stored for this provider? */
function refOk(provider: WidgetProvider, ref: string): boolean {
  switch (provider) {
    case 'SPOTIFY': {
      const [type, id, ...x] = ref.split('/');
      return x.length === 0 && SPOTIFY_TYPES.includes(type ?? '') && ID.test(id ?? '');
    }
    case 'APPLE_MUSIC':
      return canonicalApple(ref) === ref;
    case 'YOUTUBE': {
      const [kind, id, ...x] = ref.split('/');
      return x.length === 0 && (kind === 'v' || kind === 'list') && ID.test(id ?? '');
    }
    case 'SOUNDCLOUD':
      return SOUNDCLOUD_CANON.test(ref) && !(ref.split('/').length === 5 && SOUNDCLOUD_PROFILE_PAGES.includes(ref.split('/')[4]!.toLowerCase()));
    case 'GOOGLE_MAPS':
      return placeOk(ref);
    case 'CALCOM':
    case 'CALENDLY': {
      const parts = ref.split('/');
      return parts.length >= 1 && parts.length <= 2 && parts.every((p) => ID.test(p));
    }
    case 'CANVA': {
      const parts = ref.split('/');
      return parts.length === 2 && parts.every((p) => ID.test(p));
    }
  }
}

const ok = (provider: WidgetProvider, embedRef: string): WidgetParse => ({ ok: true, provider, embedRef });
const refuse = (provider: WidgetProvider): WidgetParse => ({ ok: false, short: false, message: MESSAGES[provider] });
const shortLink = (provider: WidgetProvider): WidgetParse => ({ ok: false, short: true, provider });

function parseSpotify(u: URL): WidgetParse {
  let parts = segments(u.pathname);
  if (parts[0] !== undefined && /^intl-[a-z]{2,3}(-[a-z]{2,4})?$/i.test(parts[0])) parts = parts.slice(1);
  const [type, id, ...x] = parts;
  if (x.length > 0 || !type || !id || !SPOTIFY_TYPES.includes(type) || !ID.test(id)) return refuse('SPOTIFY');
  return ok('SPOTIFY', `${type}/${id}`);
}

function parseApple(u: URL): WidgetParse {
  const parts = segments(u.pathname);
  const [cc, type, ...tail] = parts;
  if (!cc || !type) return refuse('APPLE_MUSIC');
  const decoded: string[] = [];
  for (const t of tail) {
    const d = decodeSegment(t);
    if (d === null) return refuse('APPLE_MUSIC');
    decoded.push(encodeURIComponent(d));
  }
  const i = u.searchParams.get('i');
  const ref = `${cc.toLowerCase()}/${type}/${decoded.join('/')}${i !== null ? `?i=${i}` : ''}`;
  const canon = canonicalApple(ref);
  return canon === null ? refuse('APPLE_MUSIC') : ok('APPLE_MUSIC', canon);
}

function parseYouTube(u: URL): WidgetParse {
  const parts = segments(u.pathname);
  const v = u.searchParams.get('v');
  const list = u.searchParams.get('list');
  if (u.hostname === 'youtu.be') {
    return parts.length === 1 && ID.test(parts[0]!) ? ok('YOUTUBE', `v/${parts[0]}`) : refuse('YOUTUBE');
  }
  if (parts.length === 2 && parts[0] === 'shorts') {
    return ID.test(parts[1]!) ? ok('YOUTUBE', `v/${parts[1]}`) : refuse('YOUTUBE');
  }
  if (parts.length === 1 && parts[0] === 'watch') {
    if (v !== null) return ID.test(v) ? ok('YOUTUBE', `v/${v}`) : refuse('YOUTUBE');
    if (list !== null && ID.test(list)) return ok('YOUTUBE', `list/${list}`);
    return refuse('YOUTUBE');
  }
  if (parts.length === 1 && parts[0] === 'playlist' && list !== null && ID.test(list)) {
    return ok('YOUTUBE', `list/${list}`);
  }
  return refuse('YOUTUBE');
}

/** Second segments that are a profile's own pages, not a track (and `sets` with no playlist after it). */
const SOUNDCLOUD_PROFILE_PAGES = ['likes', 'reposts', 'albums', 'tracks', 'popular-tracks', 'followers', 'following', 'comments', 'sets'];

function parseSoundCloud(u: URL): WidgetParse {
  const parts = segments(u.pathname);
  const word = /^[A-Za-z0-9_-]+$/;
  if (parts.length === 2 && parts.every((p) => word.test(p)) && !SOUNDCLOUD_PROFILE_PAGES.includes(parts[1]!.toLowerCase())) {
    return ok('SOUNDCLOUD', `https://soundcloud.com/${parts[0]}/${parts[1]}`);
  }
  if (parts.length === 3 && parts[1] === 'sets' && parts.every((p) => word.test(p))) {
    return ok('SOUNDCLOUD', `https://soundcloud.com/${parts[0]}/sets/${parts[2]}`);
  }
  return refuse('SOUNDCLOUD');
}

function parseMaps(u: URL): WidgetParse {
  const parts = segments(u.pathname);
  let place: string | null = null;
  if (parts[0] === 'maps' && parts[1] === 'place' && parts[2] !== undefined) {
    try {
      place = decodeURIComponent(parts[2].replace(/\+/g, ' '));
    } catch {
      return refuse('GOOGLE_MAPS');
    }
  } else if ((parts.length === 0 && u.hostname === 'maps.google.com') || (parts.length === 1 && parts[0] === 'maps')) {
    place = u.searchParams.get('q');
  }
  place = place === null ? null : place.trim();
  return place !== null && placeOk(place) ? ok('GOOGLE_MAPS', place) : refuse('GOOGLE_MAPS');
}

function parseBooking(provider: 'CALCOM' | 'CALENDLY', u: URL): WidgetParse {
  const parts = segments(u.pathname);
  if (parts.length < 1 || parts.length > 2 || !parts.every((p) => ID.test(p))) return refuse(provider);
  return ok(provider, parts.join('/'));
}

function parseCanva(u: URL): WidgetParse {
  const parts = segments(u.pathname);
  if (parts.length !== 4 || parts[0] !== 'design' || parts[3] !== 'view') return refuse('CANVA');
  const [, id, key] = parts as [string, string, string, string];
  return ID.test(id) && ID.test(key) ? ok('CANVA', `${id}/${key}`) : refuse('CANVA');
}

export function parseWidgetLink(raw: string): WidgetParse {
  const generic: WidgetParse = { ok: false, short: false, message: GENERIC };
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return generic;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return generic;
  switch (u.hostname) {
    case 'open.spotify.com':
      return parseSpotify(u);
    case 'spotify.link':
      return shortLink('SPOTIFY');
    case 'music.apple.com':
      return parseApple(u);
    case 'music.youtube.com':
    case 'www.youtube.com':
    case 'youtube.com':
    case 'youtu.be':
      return parseYouTube(u);
    case 'soundcloud.com':
      return parseSoundCloud(u);
    case 'on.soundcloud.com':
      return shortLink('SOUNDCLOUD');
    case 'www.google.com':
    case 'google.com':
    case 'maps.google.com':
      return parseMaps(u);
    case 'maps.app.goo.gl':
      return shortLink('GOOGLE_MAPS');
    case 'goo.gl':
    case 'www.goo.gl':
      return u.pathname === '/maps' || u.pathname.startsWith('/maps/') ? shortLink('GOOGLE_MAPS') : generic;
    case 'cal.com':
      return parseBooking('CALCOM', u);
    case 'calendly.com':
      return parseBooking('CALENDLY', u);
    case 'www.canva.com':
    case 'canva.com':
      return parseCanva(u);
    default:
      return generic;
  }
}

/** The player's iframe address. Throws when `embedRef` is not one this module stored. */
export function widgetSrc(provider: WidgetProvider, embedRef: string): string {
  if (!refOk(provider, embedRef)) throw new Error(`Invalid ${provider} widget reference`);
  switch (provider) {
    case 'SPOTIFY':
      return `https://open.spotify.com/embed/${embedRef}`;
    case 'APPLE_MUSIC':
      return `https://embed.music.apple.com/${embedRef}`;
    case 'YOUTUBE': {
      const [kind, id] = embedRef.split('/') as [string, string];
      return kind === 'v'
        ? `https://www.youtube-nocookie.com/embed/${id}`
        : `https://www.youtube-nocookie.com/embed/videoseries?list=${id}`;
    }
    case 'SOUNDCLOUD':
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(embedRef)}`;
    case 'GOOGLE_MAPS':
      return `https://www.google.com/maps?q=${encodeURIComponent(embedRef)}&output=embed`;
    case 'CALCOM':
      return `https://cal.com/${embedRef}?embed=true`;
    case 'CALENDLY':
      return `https://calendly.com/${embedRef}?embed_type=Inline&hide_gdpr_banner=1`;
    case 'CANVA':
      return `https://www.canva.com/design/${embedRef}/view?embed`;
  }
}

/** Frame height in px; 0 means the frame keeps an aspect ratio instead (YouTube 16:9, Canva 4:3). */
export function widgetHeight(provider: WidgetProvider, embedRef: string): number {
  switch (provider) {
    case 'SPOTIFY':
      return embedRef.startsWith('track/') || embedRef.startsWith('episode/') ? 152 : 352;
    case 'APPLE_MUSIC':
      return embedRef.split('/')[1] === 'song' ? 175 : 450;
    case 'YOUTUBE':
    case 'CANVA':
      return 0;
    case 'SOUNDCLOUD':
      return embedRef.includes('/sets/') ? 450 : 166;
    case 'GOOGLE_MAPS':
      return 300;
    case 'CALCOM':
    case 'CALENDLY':
      return 640;
  }
}

/** The smallest tile a widget reads well in. */
export function minWidgetSize(provider: WidgetProvider, embedRef: string): TileSize {
  if (provider === 'SPOTIFY' && (embedRef.startsWith('track/') || embedRef.startsWith('episode/'))) return 'SMALL';
  return 'WIDE';
}
