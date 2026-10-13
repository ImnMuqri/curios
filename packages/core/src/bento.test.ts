import { describe, expect, it } from 'vitest';
import {
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

  it('does not widen a chosen size even with odd cells', () => {
    // 7 cells total (odd), last tile is chosen SMALL. Parity fix should not apply.
    const tiles = arrangeTiles([{ size: 'BIG' }, { size: null }, { size: null }, { size: 'SMALL' }]);
    expect(tiles.map((t) => t.size)).toEqual(['BIG', 'SMALL', 'SMALL', 'SMALL']);
  });

  it('colours the first tile with the accent and the second warm, whatever their size', () => {
    const tones = arrangeTiles([{ size: 'SMALL' }, { size: 'BIG' }, { size: null }]).map((t) => t.tone);
    expect(tones).toEqual(['accent', 'warm', 'plain']);
  });

  it('returns nothing for no links', () => {
    expect(arrangeTiles([])).toEqual([]);
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
