import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PHYSICAL_FACTS } from '@curios/core/digital';
import type { Checkout, PublicItem } from '@curios/db-read';

vi.mock('@curios/db-read', () => ({ getShopItem: vi.fn(), getPageAvailability: vi.fn(async () => ({ status: 'missing', language: 'en' })) }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('./product-view.js', () => ({ ProductView: vi.fn(() => null) }));

const { getShopItem, getPageAvailability } = await import('@curios/db-read');
const { ProductView } = await import('./product-view.js');
const { default: ProductPage, generateMetadata } = await import('./page.js');

const item: PublicItem = {
  ...PHYSICAL_FACTS,
  id: 'cake',
  name: 'Kek Coklat Moist',
  slug: 'kek-coklat-moist',
  category: null,
  tag: null,
  description: 'Rich and moist, with a ganache top.',
  photoKey: 'items/cake.webp',
  priceCents: null,
  options: [{ id: 'k1', label: '1kg', priceCents: 9500 }],
};
const shop = {
  handle: 'keklina',
  displayName: 'Kek Lina',
  bio: null,
  language: 'en',
  style: 'SOFT',
  accentColor: '#2340c8',
  headingFont: 'JAKARTA',
  avatarKey: null,
  coverKey: null, coverTop: null, coverBottom: null,
  background: 'PAPER',
  backgroundColor: null,
  links: [],
  shopDescription: null,
  shopHalal: true,
  pickupEnabled: true,
  pickupNote: null,
  deliveryMode: 'NONE',
  deliveryFeeCents: null,
  minNoticeDays: 2,
  closedDays: [],
  deliveryNote: null,
  items: [item],
  canTakeOrders: true,
  payByQr: true,
  hasQr: true,
  chipMethods: null,
  vouchers: [],
} as Checkout;

beforeEach(() => vi.stubEnv('STORAGE_PUBLIC_URL', 'https://cdn.test'));
afterEach(() => vi.unstubAllEnvs());

const params = (slug = 'kek-coklat-moist') => Promise.resolve({ handle: 'keklina', slug });

describe('/[handle]/shop/[slug]', () => {
  it('is a 404 for an unknown slug, a personal page, a closed shop or an unavailable item', async () => {
    vi.mocked(getShopItem).mockResolvedValueOnce(null);
    await expect(ProductPage({ params: params('nope') })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(getShopItem).toHaveBeenCalledWith('keklina', 'nope');
  });

  it('says the page is unavailable, and not indexed, when it is suspended', async () => {
    vi.mocked(getShopItem).mockResolvedValue(null);
    vi.mocked(getPageAvailability).mockResolvedValueOnce({ status: 'suspended', language: 'ms' });
    render(await ProductPage({ params: params() }));
    expect(screen.getByRole('heading', { name: 'Halaman ini tidak tersedia' })).toBeInTheDocument();
    vi.mocked(getPageAvailability).mockResolvedValueOnce({ status: 'suspended', language: 'ms' });
    expect((await generateMetadata({ params: params() })).robots).toMatchObject({ index: false });
    vi.mocked(getShopItem).mockReset();
  });

  it('gives the view the item with its photo URL, and what the notice line needs', async () => {
    vi.mocked(getShopItem).mockResolvedValueOnce({ shop, item });
    render(await ProductPage({ params: params() }));
    const props = (vi.mocked(ProductView).mock.calls.at(-1) as unknown as [Record<string, unknown>])[0];
    expect(props).toMatchObject({
      handle: 'keklina',
      displayName: 'Kek Lina',
      halal: true,
      noticeDays: 2,
      pickup: true,
      item: { id: 'cake', photoUrl: 'https://cdn.test/items/cake.webp' },
    });
    expect(props.items).toHaveLength(1);
  });

  it('titles the tab "{item} · {page name}" and uses the item photo as the share image', async () => {
    vi.mocked(getShopItem).mockResolvedValueOnce({ shop, item });
    const meta = await generateMetadata({ params: params() });
    expect(meta.title).toBe('Kek Coklat Moist · Kek Lina');
    expect(meta.description).toBe('Rich and moist, with a ganache top.');
    expect(meta.openGraph?.images).toEqual([{ url: 'https://cdn.test/items/cake.webp' }]);
  });

  it('has no image when the item has no photo, and says its price when it has no description', async () => {
    vi.mocked(getShopItem).mockResolvedValueOnce({ shop, item: { ...item, photoKey: null, description: null } });
    const meta = await generateMetadata({ params: params() });
    expect(meta.openGraph?.images).toBeUndefined();
    expect(meta.description).toBe('Kek Coklat Moist from RM95 · Kek Lina');
  });

  it('has no metadata for an unknown slug', async () => {
    vi.mocked(getShopItem).mockResolvedValueOnce(null);
    expect(await generateMetadata({ params: params('nope') })).toEqual({});
  });
});
