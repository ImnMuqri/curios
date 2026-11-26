import { spotifyOpenUrl } from '@curios/core/widgets';

const TIMEOUT_MS = 3000;
const MAX_BYTES = 64 * 1024;
const TITLE_MAX = 200;

export type SpotifyCard = { title: string | null; image: string | null };
export type FetchSpotifyCard = (embedRef: string) => Promise<SpotifyCard>;

const NONE: SpotifyCard = { title: null, image: null };

/** A cover is kept only when it is a plain https address on one of Spotify's own image hosts. */
function coverOk(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return null;
  const h = u.hostname;
  return h === 'i.scdn.co' || h.endsWith('.scdn.co') || h.endsWith('.spotifycdn.com') ? u.toString() : null;
}

/** The body as text, or null when it runs past MAX_BYTES (the rest is never read). */
async function readCapped(res: Response): Promise<string | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The title and cover for a Spotify card, from Spotify's public oEmbed, asked once when the widget is saved.
 * The address is built from the stored ref, so the host is fixed and needs no private-address guard.
 * Anything that goes wrong -- a network error, a timeout, a redirect, a non-200, a big or odd body -- is
 * two nulls: the card then falls back to the owner's label and the Spotify mark, and the save goes on.
 */
export async function fetchSpotifyCard(embedRef: string, deps: { fetch: typeof fetch }): Promise<SpotifyCard> {
  try {
    const canonical = spotifyOpenUrl(embedRef);
    const res = await deps.fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonical)}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      return NONE;
    }
    const text = await readCapped(res);
    if (text === null) return NONE;
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return NONE;
    const { title, thumbnail_url } = data as { title?: unknown; thumbnail_url?: unknown };
    const trimmed = typeof title === 'string' ? title.trim().slice(0, TITLE_MAX).trim() : '';
    return { title: trimmed === '' ? null : trimmed, image: coverOk(thumbnail_url) };
  } catch {
    return NONE;
  }
}
