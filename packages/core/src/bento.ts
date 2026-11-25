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

export const PAGE_STYLES = ['SOFT', 'CONTRAST', 'CHUNKY', 'OUTLINE'] as const;
export type PageStyle = (typeof PAGE_STYLES)[number];

export const HEADING_FONTS = ['JAKARTA', 'BRICOLAGE', 'FRAUNCES', 'SPACE_GROTESK', 'DM_SERIF', 'OUTFIT'] as const;

/**
 * The page's background: one of the palette's bands, the same five the
 * landing page is built from. Owners pick one; text and buttons on it are
 * chosen by the page for contrast, never by the owner.
 */
export const PAGE_BACKGROUNDS = ['PAPER', 'MUDA', 'KUNING', 'BIRU', 'INK', 'CUSTOM'] as const;
export type PageBackground = (typeof PAGE_BACKGROUNDS)[number];

/**
 * The cover photos that ship with Curios, for owners without a photo of their
 * own. Stored on the page as `stock/<name>` and served by the web app from
 * /covers/<name>.webp; an uploaded cover is a storage key instead.
 */
export const STOCK_COVERS = ['kedai', 'kopi', 'dapur', 'teh', 'bunga', 'manis'] as const;
export type StockCover = (typeof STOCK_COVERS)[number];

/**
 * The stock covers the editor offers a new choice of (25 Nov: the pink flower only). The rest stay in
 * STOCK_COVERS, so a page that saved one keeps rendering it and the API keeps accepting it; the
 * editor shows such a page's own stock cover as its current choice until the owner picks another.
 */
export const OFFERED_COVERS: readonly StockCover[] = ['bunga'];

/** A cover's colours at its top and foot, six-digit hex (the API's cover-tint.ts works them out). */
export interface CoverTint {
  top: string;
  bottom: string;
}

/** The stock covers' colours, measured once the way cover-tint.ts measures an upload. */
export const STOCK_COVER_TINTS: Record<StockCover, CoverTint> = {
  kedai: { top: '#434023', bottom: '#bda37f' },
  kopi: { top: '#2e2316', bottom: '#431f0e' },
  dapur: { top: '#577643', bottom: '#c1ac99' },
  teh: { top: '#dad0b7', bottom: '#72675d' },
  bunga: { top: '#e19877', bottom: '#ac434d' },
  manis: { top: '#8f3b40', bottom: '#ada8a4' },
};

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

/** The colours of the cover a page wears: a stock cover's from the table, an upload's as it was measured. Null with none. */
export function coverTintOf(page: { coverKey: string | null; coverTop?: string | null; coverBottom?: string | null }): CoverTint | null {
  const stock = stockCoverName(page.coverKey);
  if (stock) return STOCK_COVER_TINTS[stock];
  return page.coverKey && page.coverTop && page.coverBottom ? { top: page.coverTop, bottom: page.coverBottom } : null;
}
export type HeadingFont = (typeof HEADING_FONTS)[number];

/**
 * The picture on the page's head: Small, Medium or Big. Medium is the size every page had before
 * there was a choice, so a page that never chose looks as it always did. The pixels are the page's
 * stylesheet's (Bento.module.css); this is the choice.
 */
export const AVATAR_SIZES = ['SMALL', 'MEDIUM', 'LARGE'] as const;
export type AvatarSize = (typeof AVATAR_SIZES)[number];

/** Where the cover sits: Top is the band at the head of the page; Full fills the whole page behind the content. */
export const COVER_LAYOUTS = ['TOP', 'FULL'] as const;
export type CoverLayout = (typeof COVER_LAYOUTS)[number];

/** How the page is laid out: a column of links, or a grid of sized tiles. */
export const PAGE_LAYOUTS = ['LIST', 'BENTO'] as const;
export type PageLayout = (typeof PAGE_LAYOUTS)[number];

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

/** An address's host, lowercased, or null when it does not parse. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether a host is the domain or under it: instagram.com and www.instagram.com, never
 * notinstagram.com. The one host test for a tile's label and for a source that cannot be read
 * (`isWalledSource`), so the two never disagree about what is Instagram.
 */
export function onDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** The small label on a tile. Never stored: derived from the address every render. */
export function linkKind(url: string): string {
  if (url.startsWith('mailto:')) return 'Email';
  if (url.startsWith('tel:')) return 'Phone';
  const host = hostOf(url);
  if (host === null) return 'Web';
  const match = KINDS.find(([domain]) => onDomain(host, domain));
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

/** Each band's colour as tokens.css draws it (Kuning is a 20% tint toward paper there too). */
const BAND_HEX: Record<Exclude<PageBackground, 'CUSTOM'>, string> = {
  PAPER: '#fafbfc',
  MUDA: '#eaf0ff',
  KUNING: '#fcedd8',
  BIRU: '#2340c8',
  INK: '#191f2c',
};

/** Below this the accent all but vanishes on the page: the ink accent on Dark, most accents on Biru. */
const ACCENT_MARK_MIN_CONTRAST = 2;

/**
 * Whether the accent can be seen against the page's own background, for the
 * marks drawn straight on the page in it (the chat's dot). Where it cannot,
 * those marks take the page's text colour instead. `background` is the band
 * in force, and `custom` its colour when the band is Custom.
 */
export function accentShowsOn(accent: string, background: PageBackground, custom: string | null = null): boolean {
  const bg = background === 'CUSTOM' ? custom : BAND_HEX[background];
  if (!bg || !isHexColor(bg) || !isHexColor(accent)) return true;
  const [hi, lo] = [luminance(accent), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05) >= ACCENT_MARK_MIN_CONTRAST;
}

/**
 * A colour taken toward paper: `share` of the colour, the rest white. What a
 * Custom background starts as -- a light tint of the page's own accent, so a
 * first pick already belongs to the page.
 */
export function tintOf(hex: string, share: number): string {
  const mix = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * share + 255 * (1 - share));
  return `#${[1, 3, 5].map((i) => mix(i).toString(16).padStart(2, '0')).join('')}`;
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

/** Whether a size is enough for a minimum: Small < Wide, Tall < Big, but Wide does not cover a Tall minimum nor Tall a Wide one. */
function meetsMinimum(size: TileSize, min: TileSize): boolean {
  return size === 'BIG' || min === 'SMALL' || size === min;
}

/**
 * The shopfront arrangement: each tile's size and colour.
 *
 * A tile with a size keeps it. An automatic one takes its size from its
 * position, and the last automatic tile widens when the grid would otherwise
 * end with half a row empty. Tone follows position only: the first tile
 * carries the accent, the second the warm colour.
 *
 * `minSize` (a widget that cannot be drawn small) lifts a size that is below
 * the tile's minimum to the minimum itself; it never lowers one. The items may
 * be the entries `pageEntries` returns.
 */
export function arrangeTiles<T extends { size: TileSize | null }>(
  links: T[],
  minSize?: (item: T) => TileSize,
): { link: T; size: TileSize; tone: Tone }[] {
  const tiles = links.map((link, index) => {
    let size = link.size ?? autoSize(index, links.length);
    const min = minSize?.(link);
    if (min && !meetsMinimum(size, min)) size = min;
    return {
      link,
      size,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      tone: (index === 0 ? 'accent' : index === 1 ? 'warm' : 'plain') as Tone,
    };
  });

  const last = tiles.at(-1);
  const cells = tiles.reduce((sum, tile) => sum + CELLS[tile.size], 0);
  if (last && last.link.size === null && last.size === 'SMALL' && cells % 2 === 1) last.size = 'WIDE';

  return tiles;
}

/**
 * The shop tile's id wherever a list of tiles is ordered -- the links order
 * the editor sends, and the entries `withShopTile` returns. Link ids are cuids,
 * so this can never collide with one.
 */
export const SHOP_TILE_ID = 'shop';

export interface ShopTilePlacement {
  position: number;
  size: TileSize | null;
}

/** The "People often ask" block's id in the same ordered lists as SHOP_TILE_ID. */
export const FAQ_TILE_ID = 'faq';

export type BentoEntry<L> =
  | { kind: 'link'; id: string; size: TileSize | null; link: L }
  | { kind: 'shop'; id: typeof SHOP_TILE_ID; size: TileSize | null };

export type PageEntry<L> = BentoEntry<L> | { kind: 'faq'; id: typeof FAQ_TILE_ID; size: 'WIDE' };

/**
 * Everything on the page in visitor order: the links, with the shop tile (when the shop is open) and
 * the FAQ block (when `faq` is not null) inserted at their positions. A null FAQ position means after the last item.
 *
 * Every caller on a BUSINESS page passes `faq: { position: page.faqPosition }` whether or not answers
 * exist, so the editor's list and the public page agree; the renderer draws nothing for a faq entry
 * with no answers. A personal page passes null.
 *
 * Positions are indexes into the finished list, as the editor sends it, so the pieces are inserted
 * lowest position first. Each is clamped rather than trusted: an owner who parks the shop tile last
 * and then removes links leaves it pointing past the end -- it must still show, last, not disappear.
 */
export function pageEntries<L extends { id: string; size: TileSize | null }>(
  links: L[],
  shop: ShopTilePlacement | null,
  faq: { position: number | null } | null,
): PageEntry<L>[] {
  const entries: PageEntry<L>[] = links.map((link) => ({ kind: 'link', id: link.id, size: link.size, link }));
  const pieces: { position: number; entry: PageEntry<L> }[] = [];
  if (shop) pieces.push({ position: shop.position, entry: { kind: 'shop', id: SHOP_TILE_ID, size: shop.size } });
  if (faq) {
    pieces.push({
      position: faq.position ?? Number.POSITIVE_INFINITY,
      entry: { kind: 'faq', id: FAQ_TILE_ID, size: 'WIDE' },
    });
  }
  // Stable sort: on a tie the shop (pushed first) stays ahead.
  pieces.sort((a, b) => a.position - b.position);
  for (const { position, entry } of pieces) {
    const at = Math.min(Math.max(0, Math.trunc(position)), entries.length);
    entries.splice(at, 0, entry);
  }
  return entries;
}

/**
 * The page's tiles in visitor order: its links, with the shop tile inserted
 * at its position when the shop is open.
 */
export function withShopTile<L extends { id: string; size: TileSize | null }>(
  links: L[],
  shop: ShopTilePlacement | null,
): BentoEntry<L>[] {
  return pageEntries(links, shop, null) as BentoEntry<L>[];
}
