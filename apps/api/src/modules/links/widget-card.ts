import { appleLookup, cardImageOk, widgetOpenUrl, type WidgetProvider } from '@curios/core/widgets';

const TIMEOUT_MS = 3000;
const MAX_BYTES = 64 * 1024;
const TITLE_MAX = 200;

export type WidgetCard = { title: string | null; image: string | null };
export type FetchWidgetCard = (provider: WidgetProvider, embedRef: string) => Promise<WidgetCard>;

const NONE: WidgetCard = { title: null, image: null };

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

/** The name Apple's lookup gives the item: a song's, else an album's, else an artist's. */
function appleTitle(r: Record<string, unknown>): unknown {
  return r.trackName ?? r.collectionName ?? r.artistName;
}

/**
 * Asks the service's public lookup for `url`, once, and returns the JSON object it answers with, or null:
 * no redirects, a short timeout, a capped body, and nothing but a plain object counts.
 */
async function lookup(url: string, deps: { fetch: typeof fetch }): Promise<Record<string, unknown> | null> {
  const res = await deps.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  const text = await readCapped(res);
  if (text === null) return null;
  const data: unknown = JSON.parse(text);
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
}

/** The cover when it is on the service's own image host (and not over-long), else null. */
const cover = (provider: WidgetProvider, raw: unknown): string | null => (typeof raw === 'string' && cardImageOk(provider, raw) ? raw : null);

const cleanTitle = (title: unknown): string | null => {
  const t = typeof title === 'string' ? title.trim().slice(0, TITLE_MAX).trim() : '';
  return t === '' ? null : t;
};

/**
 * The title and cover for a card (Spotify or Apple Music), from the service's public lookup, asked once when
 * the widget is saved. The address is built from the stored ref, so the host is fixed and needs no
 * private-address guard. Anything that goes wrong -- a network error, a timeout, a redirect, a non-200, a big
 * or odd body, a playlist Apple cannot look up -- is two nulls: the card then falls back to the owner's label
 * and the service's mark, and the save goes on.
 */
export async function fetchWidgetCard(provider: WidgetProvider, embedRef: string, deps: { fetch: typeof fetch }): Promise<WidgetCard> {
  try {
    if (provider === 'SPOTIFY') {
      const canonical = widgetOpenUrl('SPOTIFY', embedRef);
      const data = await lookup(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonical)}`, deps);
      return data ? { title: cleanTitle(data.title), image: cover('SPOTIFY', data.thumbnail_url) } : NONE;
    }
    if (provider === 'APPLE_MUSIC') {
      widgetOpenUrl('APPLE_MUSIC', embedRef);
      const found = appleLookup(embedRef);
      if (!found) return NONE;
      const data = await lookup(`https://itunes.apple.com/lookup?id=${found.id}&country=${found.country}`, deps);
      const results = data?.results;
      const first: unknown = Array.isArray(results) ? results[0] : null;
      if (typeof first !== 'object' || first === null) return NONE;
      const r = first as Record<string, unknown>;
      const art = typeof r.artworkUrl100 === 'string' ? r.artworkUrl100.replace('100x100', '300x300') : null;
      return { title: cleanTitle(appleTitle(r)), image: cover('APPLE_MUSIC', art) };
    }
    return NONE;
  } catch {
    return NONE;
  }
}
