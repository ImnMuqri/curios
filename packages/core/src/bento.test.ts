import { describe, expect, it } from 'vitest';
import {
  positionsAfterAdd,
  accentShowsOn,
  coverTintOf,
  FAQ_TILE_ID,
  pageEntries,
  placeTiles,
  STOCK_COVER_TINTS,
  arrangeTiles,
  charCount,
  isHexColor,
  LABEL_MAX,
  linkKind,
  normalizeLinkUrl,
  PAGE_BACKGROUNDS,
  readableOn,
  SHOP_TILE_ID,
  STOCK_COVERS,
  stockCoverKey,
  stockCoverName,
  tintOf,
  withShopTile,
  type TileSize,
} from './bento.js';

const auto = (n: number) => Array.from({ length: n }, () => ({ size: null as TileSize | null }));
const sizes = (n: number) => arrangeTiles(auto(n)).map((t) => t.size);

describe('charCount', () => {
  // "🎂" is two UTF-16 units. A limit on .length would call 20 cakes 40.
  it('counts code points, not UTF-16 units', () => {
    expect(charCount('🎂'.repeat(LABEL_MAX))).toBe(LABEL_MAX);
    expect(charCount('abc')).toBe(3);
  });
});

describe('normalizeLinkUrl', () => {
  it('adds https:// to a bare address and trims noise', () => {
    expect(normalizeLinkUrl('  wa.me/60123  ')).toBe('https://wa.me/60123');
    expect(normalizeLinkUrl('HTTPS://WA.ME/60123')).toBe('https://wa.me/60123');
  });

  it('keeps email and phone links', () => {
    expect(normalizeLinkUrl('mailto:iman@example.com')).toBe('mailto:iman@example.com');
    expect(normalizeLinkUrl('tel:+60123456789')).toBe('tel:+60123456789');
  });

  // A javascript: link on a public page runs in every visitor's browser.
  it('refuses every other scheme', () => {
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeLinkUrl('data:text/html,hi')).toBeNull();
    expect(normalizeLinkUrl('ftp://example.com')).toBeNull();
  });

  it('refuses something that is not an address', () => {
    expect(normalizeLinkUrl('')).toBeNull();
    expect(normalizeLinkUrl('   ')).toBeNull();
    expect(normalizeLinkUrl('localhost:3000')).toBeNull();
    expect(normalizeLinkUrl('not a link')).toBeNull();
    // No-dot host check: localhost with valid http: scheme
    expect(normalizeLinkUrl('http://localhost')).toBeNull();
  });

  it('trims trailing slash from a bare domain', () => {
    expect(normalizeLinkUrl('wa.me')).toBe('https://wa.me');
  });
});

describe('linkKind', () => {
  it('names the platforms owners link to most', () => {
    expect(linkKind('https://wa.me/60123')).toBe('WhatsApp');
    expect(linkKind('https://www.instagram.com/nadia')).toBe('Instagram');
    expect(linkKind('https://my.linkedin.com/in/iman')).toBe('LinkedIn');
    expect(linkKind('https://shopee.com.my/nadia')).toBe('Shopee');
    expect(linkKind('mailto:a@b.co')).toBe('Email');
    expect(linkKind('tel:+60123')).toBe('Phone');
  });

  it('matches on the host only', () => {
    expect(linkKind('https://notinstagram.com')).toBe('Web');
    expect(linkKind('https://nadia.my/instagram.com')).toBe('Web');
  });
});

describe('isHexColor', () => {
  it('accepts six-digit hex only', () => {
    expect(isHexColor('#0c7a62')).toBe(true);
    expect(isHexColor('#0C7A62')).toBe(true);
    expect(isHexColor('#fff')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor('#0c7a62; background:url(x)')).toBe(false);
  });
});

describe('readableOn', () => {
  it('puts light text on a dark accent and dark text on a light one', () => {
    expect(readableOn('#0c7a62')).toBe('light');
    expect(readableOn('#2340c8')).toBe('light');
    expect(readableOn('#10231f')).toBe('light');
    expect(readableOn('#f2a33c')).toBe('dark');
    expect(readableOn('#ffffff')).toBe('dark');
  });
});

describe('arrangeTiles', () => {
  it('makes an automatic first Tall Wide when it would leave a hole (auto, Wide, auto)', () => {
    expect(arrangeTiles([{ size: null }, { size: 'WIDE' }, { size: null }]).map((t) => t.size)).toEqual(['WIDE', 'WIDE', 'WIDE']);
  });

  it('widens a lone Small that is interior, with nothing to backfill it', () => {
    expect(arrangeTiles([{ size: null }, { size: 'WIDE' }, { size: null }, { size: 'WIDE' }]).map((t) => t.size)).toEqual(['WIDE', 'WIDE', 'WIDE', 'WIDE']);
    expect(arrangeTiles([{ size: 'SMALL' }, { size: 'WIDE' }, { size: 'WIDE' }, { size: 'SMALL' }, { size: 'WIDE' }, { size: 'WIDE' }]).map((t) => t.size)).toEqual(['SMALL', 'WIDE', 'WIDE', 'SMALL', 'WIDE', 'WIDE']);
    // Dense flow backfills the first Small's hole with the second: both stay Small. With nothing after, a lone one widens.
    expect(arrangeTiles([{ size: 'SMALL' }, { size: 'WIDE' }, { size: 'WIDE' }, { size: 'WIDE' }]).map((t) => t.size)).toEqual(['WIDE', 'WIDE', 'WIDE', 'WIDE']);
  });

  it('fills the half row above a Wide FAQ (auto, WIDE, auto, FAQ)', () => {
    const items = [{ size: null }, { size: 'WIDE' as TileSize | null }, { size: null }, { size: 'WIDE' as TileSize | null }];
    expect(arrangeTiles(items).map((t) => t.size)).toEqual(['WIDE', 'WIDE', 'WIDE', 'WIDE']);
  });

  it('leaves a full row of two Smalls alone', () => {
    expect(arrangeTiles([{ size: 'SMALL' }, { size: 'SMALL' }, { size: 'WIDE' }]).map((t) => t.size)).toEqual(['SMALL', 'SMALL', 'WIDE']);
  });

  it('keeps a chosen Tall even when it leaves a hole', () => {
    expect(arrangeTiles([{ size: 'TALL' }, { size: 'WIDE' }, { size: null }]).map((t) => t.size)[0]).toBe('TALL');
  });

  it('gives one link a wide tile, never a tall one with a hole beside it', () => {
    expect(sizes(1)).toEqual(['WIDE']);
  });

  it('gives two links two tiles side by side', () => {
    expect(sizes(2)).toEqual(['SMALL', 'SMALL']);
  });

  it('builds the shopfront arrangement from three links up', () => {
    expect(sizes(3)).toEqual(['TALL', 'SMALL', 'SMALL']);
    expect(sizes(6)).toEqual(['TALL', 'SMALL', 'SMALL', 'SMALL', 'SMALL', 'WIDE']);
  });

  // An odd number of cells leaves half a row empty at the bottom.
  it('widens the last automatic tile rather than leave a hole', () => {
    expect(sizes(4)).toEqual(['TALL', 'SMALL', 'SMALL', 'WIDE']);
    expect(sizes(7)).toEqual(['TALL', 'SMALL', 'SMALL', 'SMALL', 'SMALL', 'WIDE', 'WIDE']);
  });

  it('keeps a size the owner chose, and does not widen it', () => {
    const tiles = arrangeTiles([{ size: 'BIG' }, { size: null }, { size: 'SMALL' }]);
    expect(tiles.map((t) => t.size)).toEqual(['BIG', 'SMALL', 'SMALL']);
  });

  it('widens a chosen Small left alone in the last row (no half row wins over a chosen size)', () => {
    const tiles = arrangeTiles([{ size: 'BIG' }, { size: null }, { size: null }, { size: 'SMALL' }]);
    expect(tiles.map((t) => t.size)).toEqual(['BIG', 'SMALL', 'SMALL', 'WIDE']);
  });

  it('colours the first tile with the accent and the second warm, whatever their size', () => {
    const tones = arrangeTiles([{ size: 'SMALL' }, { size: 'BIG' }, { size: null }]).map((t) => t.tone);
    expect(tones).toEqual(['accent', 'warm', 'plain']);
  });

  it('returns nothing for no links', () => {
    expect(arrangeTiles([])).toEqual([]);
  });

  it('ends five owner-chosen Small tiles with the last one Wide', () => {
    const five = Array.from({ length: 5 }, () => ({ size: 'SMALL' as TileSize | null }));
    expect(arrangeTiles(five).map((t) => t.size)).toEqual(['SMALL', 'SMALL', 'SMALL', 'SMALL', 'WIDE']);
  });

  it('keeps an automatic last tile Wide when its minimum is Wide', () => {
    const items = [{ size: 'SMALL' as TileSize | null }, { size: 'SMALL' as TileSize | null }, { size: null }];
    expect(arrangeTiles(items, () => 'WIDE').map((t) => t.size)).toEqual(['WIDE', 'WIDE', 'WIDE']);
  });

  it('widens an automatic Small at the end after a raise in the middle', () => {
    const S = 'SMALL' as TileSize;
    const items = [{ size: S as TileSize | null, min: S }, { size: S as TileSize | null, min: S }, { size: S as TileSize | null, min: 'WIDE' as TileSize }, { size: null, min: S }];
    // Small, Small, (Small raised to Wide), then an automatic Small alone on row 3 -> Wide.
    expect(arrangeTiles(items, (i) => i.min).map((t) => t.size)).toEqual(['SMALL', 'SMALL', 'WIDE', 'WIDE']);
  });

  it('lets dense flow backfill a hole, so a raise that leaves the grid full changes nothing else', () => {
    const items = [{ size: 'SMALL' as TileSize | null, min: 'SMALL' as TileSize }, { size: 'SMALL' as TileSize | null, min: 'WIDE' as TileSize }, { size: 'SMALL' as TileSize | null, min: 'SMALL' as TileSize }];
    expect(arrangeTiles(items, (i) => i.min).map((t) => t.size)).toEqual(['SMALL', 'WIDE', 'SMALL']);
  });

  it('leaves no trailing half row for Tall, Small, then a Wide-minimum widget', () => {
    const items = [{ size: 'TALL' as TileSize | null, min: 'SMALL' as TileSize }, { size: 'SMALL' as TileSize | null, min: 'SMALL' as TileSize }, { size: 'SMALL' as TileSize | null, min: 'WIDE' as TileSize }];
    const sizes = arrangeTiles(items, (i) => i.min).map((t) => t.size);
    expect(sizes).toEqual(['TALL', 'SMALL', 'WIDE']);
    // Wide cannot fit beside the Tall, so it drops to row 3 and fills it: no hole at the foot.
    expect(placeTiles(sizes)).toEqual([{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 2, col: 0 }]);
  });

  it('leaves a lone cell beside the bottom of a Tall as it is', () => {
    const tiles = arrangeTiles([{ size: 'TALL' }, { size: 'SMALL' }]);
    expect(tiles.map((t) => t.size)).toEqual(['TALL', 'SMALL']);
  });

  it('raises a size below its minimum to the minimum, and never lowers one', () => {
    const items = [{ size: 'SMALL' as TileSize | null, min: 'WIDE' as TileSize }, { size: 'SMALL' as TileSize | null, min: 'SMALL' as TileSize }, { size: 'BIG' as TileSize | null, min: 'WIDE' as TileSize }];
    expect(arrangeTiles(items, (i) => i.min).map((t) => t.size)).toEqual(['WIDE', 'WIDE', 'BIG']);
  });

  it('lets Wide satisfy only a Wide minimum, Tall only Tall, and Big anything', () => {
    const one = (size: TileSize, min: TileSize) => arrangeTiles([{ size }], () => min)[0]?.size;
    expect(one('WIDE', 'WIDE')).toBe('WIDE');
    expect(one('TALL', 'WIDE')).toBe('WIDE');
    expect(one('WIDE', 'TALL')).toBe('TALL');
    expect(one('SMALL', 'TALL')).toBe('TALL');
    expect(one('BIG', 'TALL')).toBe('BIG');
    expect(one('WIDE', 'BIG')).toBe('BIG');
  });

  it('keeps the FAQ Wide whatever else is set', () => {
    const entries = pageEntries([{ id: 'a', size: 'SMALL' as TileSize | null }], null, { position: 0 });
    expect(arrangeTiles(entries, () => 'SMALL')[0]).toMatchObject({ size: 'WIDE' });
  });
});

describe('stock covers', () => {
  it('names a stock cover from its key, and nothing else', () => {
    expect(stockCoverName(stockCoverKey('kedai'))).toBe('kedai');
    expect(stockCoverName('stock/manis')).toBe('manis');
    // An uploaded cover is a storage key, not a stock one.
    expect(stockCoverName('covers/page1/abc.webp')).toBeNull();
    // A made-up stock name must never resolve to a file path.
    expect(stockCoverName('stock/../../etc/passwd')).toBeNull();
    expect(stockCoverName('stock/')).toBeNull();
    expect(stockCoverName(null)).toBeNull();
  });

  it('ships every cover the editor offers', () => {
    expect(STOCK_COVERS).toEqual(['kedai', 'kopi', 'dapur', 'teh', 'bunga', 'manis']);
    expect(PAGE_BACKGROUNDS).toEqual(['PAPER', 'MUDA', 'KUNING', 'BIRU', 'INK', 'CUSTOM']);
  });
});

describe('tintOf', () => {
  it('takes a colour toward white by the share given', () => {
    expect(tintOf('#2340c8', 1)).toBe('#2340c8');
    expect(tintOf('#2340c8', 0)).toBe('#ffffff');
    expect(tintOf('#000000', 0.5)).toBe('#808080');
  });

  it('always gives six-digit hex, which the API accepts', () => {
    expect(isHexColor(tintOf('#0c7a62', 0.18))).toBe(true);
  });
});

describe('withShopTile', () => {
  const links = [
    { id: 'a', size: null },
    { id: 'b', size: 'WIDE' as const },
  ];

  it('leaves the links alone when there is no shop', () => {
    expect(withShopTile(links, null).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('puts the shop tile at its position', () => {
    expect(withShopTile(links, { position: 0, size: null }).map((entry) => entry.id)).toEqual([SHOP_TILE_ID, 'a', 'b']);
    expect(withShopTile(links, { position: 1, size: 'BIG' }).map((entry) => entry.id)).toEqual(['a', SHOP_TILE_ID, 'b']);
  });

  // Review Focus 1: links removed after the tile was placed last.
  it('clamps a position past the end to last, and a negative one to first', () => {
    expect(withShopTile(links, { position: 9, size: null }).at(-1)?.id).toBe(SHOP_TILE_ID);
    expect(withShopTile(links, { position: -3, size: null })[0]?.id).toBe(SHOP_TILE_ID);
    // splice counts a negative index from the end, so -1 would land before the last link.
    expect(withShopTile(links, { position: -1, size: null })[0]?.id).toBe(SHOP_TILE_ID);
  });

  it('carries its own size into the arrangement', () => {
    const tiles = arrangeTiles(withShopTile(links, { position: 0, size: 'BIG' }));
    expect(tiles[0]).toMatchObject({ size: 'BIG', tone: 'accent' });
    expect(tiles[0]?.link.kind).toBe('shop');
  });

  it('works with no links at all', () => {
    expect(withShopTile([], { position: 4, size: null }).map((entry) => entry.id)).toEqual([SHOP_TILE_ID]);
  });
});

describe('pageEntries', () => {
  const links = [
    { id: 'a', size: null },
    { id: 'b', size: null },
    { id: 'c', size: null },
  ];
  const ids = (shop: { position: number } | null, faq: { position: number | null } | null) =>
    pageEntries(links, shop && { ...shop, size: null }, faq).map((e) => e.id);

  it('puts a shop tile at position 9 among 3 links last', () => {
    expect(ids({ position: 9 }, null)).toEqual(['a', 'b', 'c', SHOP_TILE_ID]);
  });

  it('puts the FAQ last when its position is null, first at 0, and nowhere when null is passed', () => {
    expect(ids(null, { position: null })).toEqual(['a', 'b', 'c', FAQ_TILE_ID]);
    expect(ids(null, { position: 0 })).toEqual([FAQ_TILE_ID, 'a', 'b', 'c']);
    expect(ids(null, null)).toEqual(['a', 'b', 'c']);
    expect(ids(null, { position: 99 })).toEqual(['a', 'b', 'c', FAQ_TILE_ID]);
    expect(ids(null, { position: -2 })).toEqual([FAQ_TILE_ID, 'a', 'b', 'c']);
  });

  it('keeps shop and FAQ in the order they were sent', () => {
    // sent as [a, faq, b, shop, c]
    expect(ids({ position: 3 }, { position: 1 })).toEqual(['a', FAQ_TILE_ID, 'b', SHOP_TILE_ID, 'c']);
    // sent as [shop, a, b, faq, c]
    expect(ids({ position: 0 }, { position: 3 })).toEqual([SHOP_TILE_ID, 'a', 'b', FAQ_TILE_ID, 'c']);
    // sent as [a, b, c, faq, shop]
    expect(ids({ position: 4 }, { position: 3 })).toEqual(['a', 'b', 'c', FAQ_TILE_ID, SHOP_TILE_ID]);
  });

  it('keeps the shop at its saved index when a business page passes faq', () => {
    // saved from [faq, a, shop, b, c]: faq 0, shop 2
    expect(ids({ position: 2 }, { position: 0 })).toEqual([FAQ_TILE_ID, 'a', SHOP_TILE_ID, 'b', 'c']);
  });

  it('gives the FAQ a wide size', () => {
    expect(pageEntries(links, null, { position: null }).at(-1)).toMatchObject({ kind: 'faq', size: 'WIDE' });
  });
});

describe('accentShowsOn', () => {
  it('hides only an accent the page would swallow: ink on Dark, the darker accents on Biru', () => {
    expect(accentShowsOn('#191f2c', 'INK')).toBe(false);
    expect(accentShowsOn('#2340c8', 'BIRU')).toBe(false);
    expect(accentShowsOn('#6d3fb3', 'BIRU')).toBe(false);
    expect(accentShowsOn('#191f2c', 'PAPER')).toBe(true);
    expect(accentShowsOn('#2340c8', 'INK')).toBe(true);
    // Orange on a light band is a low ratio the design chose, and keeps its accent.
    expect(accentShowsOn('#e08a1e', 'PAPER')).toBe(true);
    expect(accentShowsOn('#e08a1e', 'KUNING')).toBe(true);
  });

  it('measures a Custom band by its own colour, and trusts what it cannot read', () => {
    expect(accentShowsOn('#f69697', 'CUSTOM', '#f69697')).toBe(false);
    expect(accentShowsOn('#191f2c', 'CUSTOM', '#f69697')).toBe(true);
    expect(accentShowsOn('#191f2c', 'CUSTOM', null)).toBe(true);
  });
});

describe('coverTintOf', () => {
  it('takes a stock cover from the table, an upload as measured, and nothing without both colours or a cover', () => {
    expect(coverTintOf({ coverKey: 'stock/kedai' })).toEqual(STOCK_COVER_TINTS.kedai);
    expect(coverTintOf({ coverKey: 'covers/p1/x.webp', coverTop: '#111111', coverBottom: '#222222' })).toEqual({ top: '#111111', bottom: '#222222' });
    expect(coverTintOf({ coverKey: 'covers/p1/x.webp', coverTop: null, coverBottom: null })).toBeNull();
    expect(coverTintOf({ coverKey: null, coverTop: '#111111', coverBottom: '#222222' })).toBeNull();
  });

  it('has colours for every stock cover', () => {
    for (const name of STOCK_COVERS) expect(STOCK_COVER_TINTS[name].top).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('positionsAfterAdd', () => {
  it('joins the end of the links and moves the tiles at or after it', () => {
    expect(positionsAfterAdd(2, 2, null)).toEqual({ shop: 3, faq: null });
    expect(positionsAfterAdd(2, 1, null)).toEqual({ shop: 1, faq: null });
    expect(positionsAfterAdd(0, 0, null)).toEqual({ shop: 1, faq: null });
    expect(positionsAfterAdd(2, null, 2)).toEqual({ shop: null, faq: 3 });
    expect(positionsAfterAdd(2, 2, 3)).toEqual({ shop: 3, faq: 4 });
    expect(positionsAfterAdd(3, null, null)).toEqual({ shop: null, faq: null });
  });
});
