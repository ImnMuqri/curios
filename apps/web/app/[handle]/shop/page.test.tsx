import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Checkout } from '@curios/db-read';

vi.mock('@curios/db-read', () => ({ getCheckout: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('./shop-page.js', () => ({ ShopPageView: vi.fn(() => null) }));

const { getCheckout } = await import('@curios/db-read');
const { ShopPageView } = await import('./shop-page.js');
const { default: ShopPage, generateMetadata } = await import('./page.js');

const shop: Checkout = {
  handle: 'nadia',
  displayName: 'Nadia Bakes',
  bio: null,
  language: 'ms',
  style: 'SOFT',
  accentColor: '#2340c8',
  headingFont: 'JAKARTA',
  avatarKey: null,
  coverKey: null,
  background: 'PAPER',
  backgroundColor: null,
  links: [
    { label: 'IG', url: 'https://instagram.com/nadia' },
    { label: 'WA', url: 'https://wa.me/60123456789' },
  ],
  pickupEnabled: true,
  shopDescription: 'Cakes for every Raya.',
  shopHalal: false,
  pickupNote: 'Shah Alam',
  deliveryMode: 'FLAT',
  deliveryFeeCents: 800,
  minNoticeDays: 2,
  closedDays: [],
  deliveryNote: null,
  items: [
    { id: 'cake', name: 'Kek Batik', slug: 'cake', category: null, tag: null, description: null, photoKey: 'items/cake.webp', priceCents: null, options: [{ id: 'k1', label: '1kg', priceCents: 9500 }] },
    { id: 'cookie', name: 'Cookies', slug: 'cookie', category: null, tag: null, description: null, photoKey: null, priceCents: 2500, options: [] },
  ],
  canTakeOrders: true,
};

beforeEach(() => {
  vi.stubEnv('STORAGE_PUBLIC_URL', 'https://cdn.test');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const call = (props: Record<string, unknown>) => (vi.mocked(ShopPageView).mock.calls.at(-1) as unknown as [Record<string, unknown>])[0] ?? props;

describe('/[handle]/shop', () => {
  it('is a 404 when there is no shop to show', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce(null);
    await expect(ShopPage({ params: Promise.resolve({ handle: 'nope' }), searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('hands the view its items with photo URLs, the WhatsApp number, the language and the item to open', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce(shop);
    render(await ShopPage({ params: Promise.resolve({ handle: 'nadia' }), searchParams: Promise.resolve({ item: 'cake' }) }));
    const props = call({});
    expect(props.language).toBe('ms');
    expect(props.copy).toBeUndefined();
    expect(props.initialItemId).toBe('cake');
    expect(props.handle).toBe('nadia');
    expect(props.displayName).toBe('Nadia Bakes');
    expect(props.pickupNote).toBe('Shah Alam');
    expect(props.description).toBe('Cakes for every Raya.');
    expect(props.halal).toBe(false);
    expect((props.items as { id: string; photoUrl: string | null }[]).map((i) => [i.id, i.photoUrl])).toEqual([
      ['cake', 'https://cdn.test/items/cake.webp'],
      ['cookie', null],
    ]);
  });

  it('tells the view whether the shop takes orders, so its bar is Checkout or WhatsApp', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce(shop);
    render(await ShopPage({ params: Promise.resolve({ handle: 'nadia' }), searchParams: Promise.resolve({}) }));
    expect(call({}).canTakeOrders).toBe(true);
    vi.mocked(getCheckout).mockResolvedValueOnce({ ...shop, canTakeOrders: false });
    render(await ShopPage({ params: Promise.resolve({ handle: 'nadia' }), searchParams: Promise.resolve({}) }));
    expect(call({}).canTakeOrders).toBe(false);
  });

  it('opens nothing when the URL names no item', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce(shop);
    render(await ShopPage({ params: Promise.resolve({ handle: 'nadia' }), searchParams: Promise.resolve({}) }));
    expect(call({}).initialItemId).toBeNull();
  });

  it('gives the next day an order could be for, and none when paused', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce(shop);
    render(await ShopPage({ params: Promise.resolve({ handle: 'nadia' }), searchParams: Promise.resolve({}) }));
    expect(call({}).nextDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    vi.mocked(getCheckout).mockResolvedValueOnce({ ...shop, canTakeOrders: false });
    render(await ShopPage({ params: Promise.resolve({ handle: 'nadia' }), searchParams: Promise.resolve({}) }));
    expect(call({}).nextDay).toBeNull();
  });

  it('wears the owner look without the page header, and holds the basket bar', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce(shop);
    const { container } = render(await ShopPage({ params: Promise.resolve({ handle: 'nadia' }), searchParams: Promise.resolve({}) }));
    expect(container.querySelector('[data-bg]')).not.toBeNull();
    expect(container.querySelector('[data-bento-page]')).toBeNull();
    expect(container.querySelector('header')).toBeNull();
  });

  it('titles the tab with the shop name, and nothing for a missing shop', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce(shop);
    expect(await generateMetadata({ params: Promise.resolve({ handle: 'nadia' }) })).toEqual({ title: 'Nadia Bakes · Shop' });
    vi.mocked(getCheckout).mockResolvedValueOnce(null);
    expect(await generateMetadata({ params: Promise.resolve({ handle: 'nope' }) })).toEqual({});
  });
});
