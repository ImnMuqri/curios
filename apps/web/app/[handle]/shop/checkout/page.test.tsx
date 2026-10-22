import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Checkout } from '@curios/db-read';

vi.mock('@curios/db-read', () => ({ getCheckout: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
}));
vi.mock('./checkout.js', () => ({ Checkout: vi.fn(() => null) }));

const { getCheckout } = await import('@curios/db-read');
const { Checkout: CheckoutView } = await import('./checkout.js');
const { default: CheckoutPage, generateMetadata } = await import('./page.js');

const shop: Checkout = {
  handle: 'keklina',
  displayName: 'Kek Lina',
  bio: null,
  language: 'en',
  style: 'SOFT',
  accentColor: '#b5294e',
  headingFont: 'JAKARTA',
  avatarKey: null,
  coverKey: null,
  background: 'PAPER',
  backgroundColor: null,
  links: [{ label: 'WA', url: 'https://wa.me/60123456789' }],
  shopDescription: null,
  shopHalal: false,
  pickupEnabled: true,
  pickupNote: 'Seksyen 7',
  deliveryMode: 'FLAT',
  deliveryFeeCents: 1000,
  deliveryNote: 'Around Shah Alam',
  minNoticeDays: 2,
  closedDays: [0],
  items: [{ id: 'batik', name: 'Kek batik', slug: 'batik', category: null, tag: null, description: null, photoKey: 'items/b.webp', priceCents: 4500, options: [] }],
  canTakeOrders: true,
};

const params = (handle: string) => ({ params: Promise.resolve({ handle }) });

beforeEach(() => vi.stubEnv('STORAGE_PUBLIC_URL', 'https://cdn.test'));
afterEach(() => vi.unstubAllEnvs());

describe('/[handle]/shop/checkout', () => {
  it('is a 404 when there is no shop', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce(null);
    await expect(CheckoutPage(params('nope'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sends the visitor back to the shop, whose bar is the WhatsApp fallback, when orders are paused', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce({ ...shop, canTakeOrders: false });
    await expect(CheckoutPage(params('keklina'))).rejects.toThrow('NEXT_REDIRECT /keklina/shop');
  });

  it('hands checkout the shop, its photos, its WhatsApp and the settings', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce(shop);
    render(await CheckoutPage(params('keklina')));
    const props = (vi.mocked(CheckoutView).mock.calls.at(-1) as unknown as [Record<string, unknown>])[0];
    expect(props).toMatchObject({
      handle: 'keklina',
      displayName: 'Kek Lina',
      whatsapp: '60123456789',
      deliveryNote: 'Around Shah Alam',
      closedDays: [0],
      minNoticeDays: 2,
    });
    expect((props.items as { photoUrl: string | null }[])[0]?.photoUrl).toBe('https://cdn.test/items/b.webp');
    expect(typeof props.now).toBe('string');
  });

  it('titles the tab', async () => {
    vi.mocked(getCheckout).mockResolvedValueOnce(shop);
    expect(await generateMetadata(params('keklina'))).toEqual({ title: 'Kek Lina · Checkout' });
  });
});
