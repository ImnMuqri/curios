import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PHYSICAL_FACTS } from '@curios/core/digital';
import type { Checkout } from '@curios/db-read';

vi.mock('@curios/db-read', () => ({ getCheckout: vi.fn(), getPageAvailability: vi.fn(async () => ({ status: 'missing', language: 'en' })) }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('./shop-page.js', () => ({ ShopPageView: vi.fn(() => null) }));

const { getCheckout, getPageAvailability } = await import('@curios/db-read');
const { redirect } = await import('next/navigation');
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
  coverKey: null, coverTop: null, coverBottom: null,
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
    { ...PHYSICAL_FACTS, id: 'cake', name: 'Kek Batik', slug: 'cake', category: null, tag: null, description: null, photoKey: 'items/cake.webp', priceCents: null, options: [{ id: 'k1', label: '1kg', priceCents: 9500 }] },
    { ...PHYSICAL_FACTS, id: 'cookie', name: 'Cookies', slug: 'cookie', category: null, tag: null, description: null, photoKey: null, priceCents: 2500, options: [] },
  ],
  canTakeOrders: true,
  payByQr: true,
  hasQr: true,
  chipMethods: null,
  vouchers: [],
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

  it('says the shop is unavailable, and not indexed, when the page is suspended', async () => {
    vi.mocked(getCheckout).mockResolvedValue(null);
    vi.mocked(getPageAvailability).mockResolvedValueOnce({ status: 'suspended', language: 'en' });
    render(await ShopPage({ params: Promise.resolve({ handle: 'nadia' }), searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('heading', { name: 'This page is unavailable' })).toBeInTheDocument();
    vi.mocked(getPageAvailability).mockResolvedValueOnce({ status: 'suspended', language: 'en' });
    expect((await generateMetadata({ params: Promise.resolve({ handle: 'nadia' }) })).robots).toMatchObject({ index: false });
    vi.mocked(getCheckout).mockReset();
  });

  it('hands the view its items with photo URLs and the language', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce(shop);
    render(await ShopPage({ params: Promise.resolve({ handle: 'nadia' }), searchParams: Promise.resolve({}) }));
    const props = call({});
    expect(props.language).toBe('ms');
    expect(props.copy).toBeUndefined();
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

  it('gives the view no vouchers when the shop is paused: a paused shop takes none', async () => {
    const raya = { id: 'v1', mode: 'AUTO' as const, kind: 'PERCENT' as const, percent: 10, amountCents: null, itemId: null, minSpendCents: null, label: 'Raya promo' };
    vi.mocked(getCheckout).mockResolvedValueOnce({ ...shop, vouchers: [raya] });
    render(await ShopPage({ params: Promise.resolve({ handle: 'nadia' }), searchParams: Promise.resolve({}) }));
    expect(call({}).vouchers).toEqual([raya]);
    vi.mocked(getCheckout).mockResolvedValueOnce({ ...shop, canTakeOrders: false, vouchers: [raya] });
    render(await ShopPage({ params: Promise.resolve({ handle: 'nadia' }), searchParams: Promise.resolve({}) }));
    expect(call({}).vouchers).toEqual([]);
  });

  it('sends a shared ?item=<id> link on to that product’s page', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce(shop);
    await expect(ShopPage({ params: Promise.resolve({ handle: 'nadia' }), searchParams: Promise.resolve({ item: 'cake' }) })).rejects.toThrow(
      'NEXT_REDIRECT /nadia/shop/cake',
    );
  });

  it('shows the shop for an item id it does not know', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce(shop);
    render(await ShopPage({ params: Promise.resolve({ handle: 'nadia' }), searchParams: Promise.resolve({ item: 'gone' }) }));
    expect(call({})).toBeDefined();
    expect(vi.mocked(redirect)).not.toHaveBeenCalledWith(expect.stringContaining('gone'));
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

  it('titles the tab with the shop name, describes it, and gives nothing for a missing shop', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce(shop);
    expect(await generateMetadata({ params: Promise.resolve({ handle: 'nadia' }) })).toEqual({ title: 'Nadia Bakes · Shop', description: 'Cakes for every Raya.' });
    vi.mocked(getCheckout).mockResolvedValueOnce({ ...shop, shopDescription: null });
    expect(await generateMetadata({ params: Promise.resolve({ handle: 'nadia' }) })).toEqual({
      title: 'Nadia Bakes · Shop',
      description: 'Order from Nadia Bakes on Curios.',
    });
    vi.mocked(getCheckout).mockResolvedValueOnce(null);
    expect(await generateMetadata({ params: Promise.resolve({ handle: 'nope' }) })).toEqual({});
  });
});
