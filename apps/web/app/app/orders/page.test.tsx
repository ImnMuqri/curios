import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerOrder, OwnerPage } from '@curios/db-read';

const getOwnerOrders = vi.fn();
const getOrderStats = vi.fn();
const getOwnerPage = vi.fn();
const getOwnerStore = vi.fn();
vi.mock('@curios/db-read', () => ({ getOwnerOrders, getOrderStats, getOwnerPage, getOwnerStore }));

const resolveOwner = vi.fn();
vi.mock('../session.js', () => ({ resolveOwner }));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'a-session-value' }) }),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

// The screen closes over apiFetch and the router; these tests are about what the page hands it.
const Orders = vi.fn((_props: Record<string, unknown>) => null);
vi.mock('./orders-screen.js', () => ({ Orders }));

const OrdersPage = (await import('./page.js')).default;

const page: OwnerPage = {
  id: 'p1',
  handle: 'keklina',
  displayName: 'Kek Lina',
  published: true,
  mode: 'BUSINESS',
  paidUntil: null,
  leadsCaptured: 0,
  ordersPlaced: 1,
  ordersAtTrialReset: 0,
  trialResetAt: null,
  storeEnabled: true,
  allowSearchIndexing: false,
  avatarKey: null,
};

const order: OwnerOrder = {
  id: 'o1',
  number: 1,
  code: 'YVA4',
  customerName: 'Mira Hassan',
  phone: '+60123456789',
  method: 'PICKUP',
  day: '2026-10-17',
  address: null,
  note: null,
  itemsCents: 9500,
  deliveryCents: 0,
  totalCents: 9500,
  status: 'PLACED',
  receiptKey: 'receipts/p1/abc.jpg',
  receiptType: 'image/jpeg',
  receiptUploadedAt: new Date('2026-10-16T02:09:00Z'),
  receiptRejectedAt: null,
  paidAt: null,
  completedAt: null,
  cancelledAt: null,
  refundedAt: null,
  createdAt: new Date('2026-10-16T02:02:00Z'),
  lines: [{ itemName: 'Kek coklat moist', optionLabel: '1kg', unitPriceCents: 9500, quantity: 1, photoKey: 'items/p1/coklat.webp' }],
};

const params = (order?: string) => ({ searchParams: Promise.resolve(order ? { order } : {}) });

describe('OrdersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('STORAGE_PUBLIC_URL', 'https://cdn.example/');
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
    getOwnerPage.mockResolvedValue(page);
    getOwnerOrders.mockResolvedValue([order]);
    getOrderStats.mockResolvedValue({ toCheck: 1, toMake: 0, paidThisWeekCents: 0, week: [0, 0, 0, 0, 0, 0, 0] });
    getOwnerStore.mockResolvedValue({ mode: 'BUSINESS', settings: { pickupNote: 'Seksyen 7, Shah Alam' }, items: [] });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('tells a personal page orders are a business page’s, and where that changes', async () => {
    getOwnerPage.mockResolvedValue({ ...page, mode: 'PERSONAL' });

    render(await OrdersPage(params()));

    expect(screen.getByText(/Orders come from a shop/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/app/billing');
    expect(Orders).not.toHaveBeenCalled();
    expect(getOwnerOrders).not.toHaveBeenCalled();
  });

  it('hands the screen its orders, with the receipt and the item photos as addresses, not keys', async () => {
    render(await OrdersPage(params()));

    const props = Orders.mock.calls[0]![0];
    const [row] = props.orders as Record<string, unknown>[];
    expect(row).toMatchObject({ id: 'o1', receiptUrl: 'https://cdn.example/receipts/p1/abc.jpg', lines: [expect.objectContaining({ photoUrl: 'https://cdn.example/items/p1/coklat.webp' })] });
    expect(row).not.toHaveProperty('receiptKey');
    expect(props).toMatchObject({ shopUrl: '/keklina/shop', pickupNote: 'Seksyen 7, Shah Alam', keptMonths: 12, selected: null });
    expect(getOrderStats).toHaveBeenCalledWith('acc1', expect.any(Date));
    expect(props.now).toBe((getOrderStats.mock.calls[0]![1] as Date).toISOString());
  });

  it('opens the order the email links to', async () => {
    render(await OrdersPage(params('o1')));

    expect(Orders.mock.calls[0]![0]).toMatchObject({ selected: 'o1' });
  });

  it('sends an owner with no page to onboarding', async () => {
    getOwnerPage.mockResolvedValue(null);
    await expect(OrdersPage(params())).rejects.toThrow('NEXT_REDIRECT:/app/onboarding');
  });
});
