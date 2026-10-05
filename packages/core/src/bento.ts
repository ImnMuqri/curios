/**
 * The rules of a My Curios page, shared by the API, the public page and the
 * editor's live preview -- so the preview cannot disagree with the page.
 *
 * Imports nothing. The `@curios/core` barrel reaches `node:crypto`, which a
 * client component may not load; this file is exported on its own
 * (`@curios/core/bento`) so the editor can use it.
 */

export const TILE_SIZES = ['SMALL', 'WIDE', 'TALL', 'BIG'] as const;
export type TileSize = (typeof TILE_SIZES)[number];

export const PAGE_STYLES = ['SOFT', 'CONTRAST'] as const;
export type PageStyle = (typeof PAGE_STYLES)[number];

export const HEADING_FONTS = ['JAKARTA', 'BRICOLAGE', 'FRAUNCES', 'SPACE_GROTESK', 'DM_SERIF', 'OUTFIT'] as const;

/**
 * The page's background: one of the palette's bands, the same five the
 * landing page is built from. Owners pick one; text and buttons on it are
 * chosen by the page for contrast, never by the owner.
 */
export const PAGE_BACKGROUNDS = ['PAPER', 'MUDA', 'KUNING', 'BIRU', 'INK'] as const;
export type PageBackground = (typeof PAGE_BACKGROUNDS)[number];

/**
 * The cover photos that ship with Curios, for owners without a photo of their
 * own. Stored on the page as `stock/<name>` and served by the web app from
 * /covers/<name>.webp; an uploaded cover is a storage key instead.
 */
export const STOCK_COVERS = ['kedai', 'kopi', 'dapur', 'teh', 'bunga', 'manis'] as const;
export type StockCover = (typeof STOCK_COVERS)[number];

const STOCK_PREFIX = 'stock/';

export function stockCoverKey(name: StockCover): string {
  return `${STOCK_PREFIX}${name}`;
}

/** The stock cover a key names, or null when it is an uploaded cover (or not a key at all). */
export function stockCoverName(key: string | null): StockCover | null {
  if (!key?.startsWith(STOCK_PREFIX)) return null;
  const name = key.slice(STOCK_PREFIX.length);
  return (STOCK_COVERS as readonly string[]).includes(name) ? (name as StockCover) : null;
}
export type HeadingFont = (typeof HEADING_FONTS)[number];

export const MAX_LINKS = 30;
export const LABEL_MAX = 40;
export const BIO_MAX = 160;
export const DISPLAY_NAME_MAX = 80;

export const DEFAULT_ACCENT = '#2340c8';
/** Chosen to look right in both styles. Custom colours are allowed too. */
export const ACCENT_PRESETS = [
  '#2340c8',
  '#0c7a62',
  '#6d3fb3',
  '#c2185b',
  '#d8452f',
  '#e08a1e',
  '#2d6a4f',
  '#191f2c',
] as const;

/** Characters as a person counts them. "🎂" is one, though it is two UTF-16 units. */
export function charCount(text: string): number {
  return [...text].length;
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * A link as it will be stored, or null when it cannot be one.
 *
 * Owners paste what the address bar shows, often without a scheme, so a bare
 * address gets https://. Only four schemes survive: anything else --
 * javascript:, data: -- would be a clickable link on a public page, running in
 * every visitor's browser.
 */
export function normalizeLinkUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) return null;
  // A web address with no dot in its host is a typo or an intranet name, never
  // something a visitor can open.
  if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.hostname.includes('.')) return null;

  // URL adds a trailing slash to a bare origin; keep what the owner typed.
  return url.href.endsWith('/') && !trimmed.endsWith('/') && url.pathname === '/'
    ? url.href.slice(0, -1)
    : url.href;
}

const KINDS: ReadonlyArray<readonly [host: string, name: string]> = [
  ['wa.me', 'WhatsApp'],
  ['whatsapp.com', 'WhatsApp'],
  ['instagram.com', 'Instagram'],
  ['linkedin.com', 'LinkedIn'],
  ['tiktok.com', 'TikTok'],
  ['facebook.com', 'Facebook'],
  ['x.com', 'X'],
  ['twitter.com', 'X'],
  ['youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['github.com', 'GitHub'],
  ['shopee.com.my', 'Shopee'],
  ['lazada.com.my', 'Lazada'],
  ['linktr.ee', 'Linktree'],
];

/** The small label on a tile. Never stored: derived from the address every render. */
export function linkKind(url: string): string {
  if (url.startsWith('mailto:')) return 'Email';
  if (url.startsWith('tel:')) return 'Phone';
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'Web';
  }
  const match = KINDS.find(([domain]) => host === domain || host.endsWith(`.${domain}`));
  return match ? match[1] : 'Web';
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** The ink and paper tokens in tokens.css, which is where text on an accent comes from. */
const INK = luminance('#191f2c');
const PAPER = luminance('#fafbfc');

/**
 * Which text colour stays readable on an accent: whichever of ink or paper has
 * the higher WCAG contrast ratio against it. This is why a custom colour cannot
 * make a page unreadable.
 */
export function readableOn(hex: string): 'dark' | 'light' {
  const l = luminance(hex);
  const withInk = (l + 0.05) / (INK + 0.05);
  const withPaper = (PAPER + 0.05) / (l + 0.05);
  return withInk >= withPaper ? 'dark' : 'light';
}

export type Tone = 'accent' | 'warm' | 'plain';

const CELLS: Record<TileSize, number> = { SMALL: 1, WIDE: 2, TALL: 2, BIG: 4 };

function autoSize(index: number, count: number): TileSize {
  // One link: a tall tile would leave its neighbour's column empty.
  if (count === 1) return 'WIDE';
  // Two links: a tall tile beside one small leaves a hole under the small.
  if (count === 2) return 'SMALL';
  if (index === 0) return 'TALL';
  if (index <= 2) return 'SMALL';
  // From the fourth: Small, Small, Wide, repeating.
  return (index - 3) % 3 === 2 ? 'WIDE' : 'SMALL';
}

/**
 * The shopfront arrangement: each link's tile size and colour.
 *
 * A link with a size keeps it. An automatic one takes its size from its
 * position, and the last automatic tile widens when the grid would otherwise
 * end with half a row empty. Tone follows position only: the first tile
 * carries the accent, the second the warm colour.
 */
export function arrangeTiles<T extends { size: TileSize | null }>(
  links: T[],
): { link: T; size: TileSize; tone: Tone }[] {
  const tiles = links.map((link, index) => ({
    link,
    size: link.size ?? autoSize(index, links.length),
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    tone: (index === 0 ? 'accent' : index === 1 ? 'warm' : 'plain') as Tone,
  }));

  const last = tiles.at(-1);
  const cells = tiles.reduce((sum, tile) => sum + CELLS[tile.size], 0);
  if (last && last.link.size === null && last.size === 'SMALL' && cells % 2 === 1) last.size = 'WIDE';

  return tiles;
}
