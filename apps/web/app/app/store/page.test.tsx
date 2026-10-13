import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const getOwnerStore = vi.fn();
const getOwnerPage = vi.fn();
vi.mock('@curios/db-read', () => ({ getOwnerStore, getOwnerPage }));

const resolveOwner = vi.fn();
vi.mock('../session.js', () => ({ resolveOwner }));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'a-session-value' }) }),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

// The screen closes over apiFetch; these tests are about what the page decides.
const StoreScreen = vi.fn((_props: Record<string, unknown>) => null);
vi.mock('./store-screen.js', () => ({ StoreScreen }));

const StorePage = (await import('./page.js')).default;

const settings = {
  enabled: true, pickupEnabled: true, pickupNote: null, deliveryMode: 'NONE', deliveryFeeCents: null,
  minNoticeDays: 0, paymentQrKey: 'qr/key.webp', bankName: null, bankAccountName: null,
  bankAccountNumber: null, tileSize: 'WIDE',
};

describe('StorePage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    redirect.mockImplementation((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    });
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
    getOwnerPage.mockResolvedValue({ handle: 'nadia' });
    vi.stubEnv('STORAGE_PUBLIC_URL', 'https://files.example/');
  });

  it('tells a personal page why there is no store, and where that changes', async () => {
    getOwnerStore.mockResolvedValue({ mode: 'PERSONAL', settings, items: [] });

    render(await StorePage());

    expect(screen.getByText(/Shops are part of business pages/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/app/billing');
    expect(StoreScreen).not.toHaveBeenCalled();
  });

  it('renders the screen for a business page, with its settings and the storage facts', async () => {
    getOwnerStore.mockResolvedValue({ mode: 'BUSINESS', settings, items: [] });

    render(await StorePage());

    expect(StoreScreen).toHaveBeenCalledTimes(1);
    const props = StoreScreen.mock.calls[0]![0];
    expect(props).toMatchObject({
      handle: 'nadia',
      uploadsEnabled: true,
      publicBase: 'https://files.example/',
      qrUrl: 'https://files.example/qr/key.webp',
    });
    expect(props.initial).toEqual(settings);
  });

  it('hands the items over with their picture URLs worked out here', async () => {
    const base = { description: null, priceCents: 2500, options: [], available: true };
    getOwnerStore.mockResolvedValue({
      mode: 'BUSINESS',
      settings,
      items: [{ ...base, id: 'a', name: 'Kek', photoKey: 'items/k.webp' }, { ...base, id: 'b', name: 'Tart', photoKey: null }],
    });
    render(await StorePage());
    const items = StoreScreen.mock.calls[0]![0].items as { id: string; photoUrl: string | null }[];
    expect(items.map((i) => [i.id, i.photoUrl])).toEqual([['a', 'https://files.example/items/k.webp'], ['b', null]]);
  });

  it('turns uploads off when storage is not configured', async () => {
    vi.stubEnv('STORAGE_PUBLIC_URL', '');
    getOwnerStore.mockResolvedValue({ mode: 'BUSINESS', settings: { ...settings, paymentQrKey: null }, items: [] });
    render(await StorePage());
    expect(StoreScreen.mock.calls[0]![0]).toMatchObject({ uploadsEnabled: false, publicBase: '', qrUrl: null });
  });

  it('sends an owner with no page to onboarding', async () => {
    getOwnerStore.mockResolvedValue(null);
    await expect(StorePage()).rejects.toThrow('NEXT_REDIRECT:/app/onboarding');
  });

  it('sends a signed-out visitor to sign in', async () => {
    resolveOwner.mockResolvedValue(null);
    await expect(StorePage()).rejects.toThrow('NEXT_REDIRECT:/signin');
  });

  it('renders no main of its own', async () => {
    getOwnerStore.mockResolvedValue({ mode: 'PERSONAL', settings, items: [] });
    render(await StorePage());
    expect(screen.queryByRole('main')).toBeNull();
  });
});
