import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';

const getOwnerPage = vi.fn();
const getConversationUsage = vi.fn();
const getRecentPayments = vi.fn();
const countLeadsThisMonth = vi.fn();
const countOrdersThisMonth = vi.fn();
const getSignInMethods = vi.fn();
vi.mock('@curios/db-read', () => ({ getOwnerPage, getConversationUsage, getRecentPayments, countLeadsThisMonth, countOrdersThisMonth, getSignInMethods }));

const resolveOwner = vi.fn();
vi.mock('../session.js', () => ({ resolveOwner }));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'a-session-value' }) }),
}));

// Throws, because the real `redirect` throws NEXT_REDIRECT. A mock that merely recorded
// the call would let control fall through a redirect the page must not survive.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

// Both client components are recorded rather than rendered: these tests are
// about what the page decides to offer, not about what those two do with it.
const PayButtons = vi.fn((_props: { options: Record<string, unknown>[]; timeline?: { today: string; paidUntil: string | null } }) => null);
vi.mock('./pay-buttons.js', () => ({ PayButtons }));
const ResetTrial = vi.fn(() => null);
vi.mock('./reset-button.js', () => ({ ResetTrial }));

const UpgradeToBusiness = vi.fn(() => null);
vi.mock('./upgrade-button.js', () => ({ UpgradeToBusiness }));

const BillingPage = (await import('./page.js')).default;

const page: OwnerPage = {
  id: 'p1',
  handle: 'nadia',
  displayName: 'Nadia Bakes',
  published: true,
  mode: 'BUSINESS',
  paidUntil: null,
  leadsCaptured: 0,
  ordersPlaced: 0,
  ordersAtTrialReset: 0,
  trialResetAt: null,
  storeEnabled: false,
  allowSearchIndexing: false,
  avatarKey: null,
};

async function renderWith(owned: OwnerPage | null, payment?: string) {
  getOwnerPage.mockResolvedValueOnce(owned);
  render(await BillingPage({ searchParams: Promise.resolve({ payment }) }));
}

// These check the figures, not how they count up (count-up.test.tsx does): motion off.
const motion = window.matchMedia.bind(window);
beforeAll(() => {
  window.matchMedia = (query: string) => ({ ...motion(query), matches: query.includes('reduce') });
});
afterAll(() => {
  window.matchMedia = motion;
});

describe('BillingPage', () => {
  beforeEach(() => {
    getOwnerPage.mockReset();
    resolveOwner.mockReset();
    PayButtons.mockClear();
    ResetTrial.mockClear();
    UpgradeToBusiness.mockClear();
    getConversationUsage.mockReset();
    getRecentPayments.mockReset();
    getConversationUsage.mockResolvedValue({ used: 12, cap: 200, period: '2026-09' });
    getRecentPayments.mockResolvedValue([]);
    countLeadsThisMonth.mockReset();
    countLeadsThisMonth.mockResolvedValue(2);
    countOrdersThisMonth.mockReset();
    countOrdersThisMonth.mockResolvedValue(7);
    getSignInMethods.mockResolvedValue({ email: 'nadia@example.com' });
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
  });

  it('offers both plans at their published prices to a business page', async () => {
    await renderWith(page);

    expect(screen.getByRole('heading', { name: 'Billing' })).toBeInTheDocument();
    // Fix round 2, Important #3: AppFrame renders its own main around every
    // screen it wraps, this one included, so a second one here would nest.
    expect(screen.queryByRole('main')).toBeNull();
    expect(PayButtons).toHaveBeenCalledTimes(1);
    expect(PayButtons.mock.calls[0]?.[0].options).toEqual([
      expect.objectContaining({ plan: 'MONTHLY', name: 'Monthly', price: 'RM49', note: 'One month at a time', period: 'a month' }),
      expect.objectContaining({ plan: 'ANNUAL', name: 'Yearly', price: 'RM490', note: 'Paid once a year', period: 'a year', save: '2 months free' }),
    ]);
  });

  it('counts the days a paid plan has left, and draws the line to where paying takes it', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-15T04:00:00.000Z'), toFake: ['Date'] });
    try {
      await renderWith({ ...page, paidUntil: new Date('2026-11-14T04:00:00.000Z') });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('days left')).toBeInTheDocument();
    expect(screen.getByText('14 Nov 2026')).toBeInTheDocument();
    expect(screen.getByText(/no auto-renew/i)).toBeInTheDocument();
    const props = PayButtons.mock.calls[0]?.[0];
    expect(props?.timeline).toEqual({ today: '15 Oct', paidUntil: '14 Nov' });
    // Paying adds to the time already paid for.
    expect(props?.options[0]).toMatchObject({ afterShort: '14 Dec', afterLong: '14 Dec 2026' });
    expect(props?.options[1]).toMatchObject({ afterShort: '14 Nov 2027' });
    expect(Number(props?.options[0]?.paidPct)).toBeCloseTo(50, 0);
  });

  it('counts the free leads left on a trial, one segment each', async () => {
    await renderWith({ ...page, leadsCaptured: 1 });

    expect(screen.getByText('Business · free trial')).toBeInTheDocument();
    expect(screen.getByText('free leads left').previousSibling).toHaveTextContent('2');
    expect(screen.getByText('1 of 3 used')).toBeInTheDocument();
    // No paid-until, so no line.
    expect(PayButtons.mock.calls[0]?.[0].timeline).toBeUndefined();
  });

  it('offers nothing to pay for on a personal page', async () => {
    await renderWith({ ...page, mode: 'PERSONAL' });

    expect(PayButtons).not.toHaveBeenCalled();
    expect(screen.getByText('Personal pages are free. There is nothing to pay for.')).toBeInTheDocument();
  });

  it('says a confirmed payment in the board’s toast, with the new date', async () => {
    await renderWith({ ...page, paidUntil: new Date('2026-12-14T00:00:00Z') }, 'paid');

    expect(await screen.findByRole('status')).toHaveTextContent('Paid. You’re covered until 14 Dec 2026.');
  });

  it('still says confirming when Billplz said paid before its callback reached us', async () => {
    await renderWith(page, 'paid');

    expect(screen.getByRole('status')).toHaveTextContent('We are still confirming your payment with Billplz.');
  });

  it('shows the banner for a payment that failed', async () => {
    await renderWith(page, 'failed');

    expect(screen.getByRole('status')).toHaveTextContent('nothing was charged');
  });

  it('sends an owner with no page to onboarding', async () => {
    await expect(renderWith(null)).rejects.toThrow('NEXT_REDIRECT:/app/onboarding');
  });

  it('shows this month’s usage against the cap', async () => {
    await renderWith(page);

    const month = screen.getByRole('region', { name: 'This month' });
    expect(within(month).getByText('12')).toBeInTheDocument();
    expect(within(month).getByText(/of 200/)).toBeInTheDocument();
    expect(within(month).getByText(/past the limit, the chat gives a short fixed reply/i)).toBeInTheDocument();
    expect(getConversationUsage).toHaveBeenCalledWith('p1', expect.any(Date));
  });

  it('says what happens past the cap, because the chat has already changed', async () => {
    getConversationUsage.mockResolvedValue({ used: 201, cap: 200, period: '2026-09' });
    await renderWith(page);

    expect(screen.getByText(/past the limit: the chat is giving a short fixed reply until/i)).toBeInTheDocument();
  });

  it('counts this month’s leads, and says the capture card stays on a paid page', async () => {
    await renderWith({ ...page, paidUntil: new Date('2099-01-01T00:00:00.000Z') });

    const meter = screen.getByText('Leads').closest('div')!;
    expect(meter).toHaveTextContent('2 no limit');
    expect(within(meter).getByText('The capture card stays on your page.')).toBeInTheDocument();
    expect(countLeadsThisMonth).toHaveBeenCalledWith('p1', expect.any(Date));
  });

  it('counts this month’s orders on a paid page, with no limit, as the board draws it', async () => {
    await renderWith({ ...page, paidUntil: new Date('2099-01-01T00:00:00.000Z'), ordersPlaced: 40 });

    const meter = screen.getByText('Orders').closest('div')!;
    expect(meter).toHaveTextContent('7 no limit');
    expect(within(meter).getByText('Take as many as you get.')).toBeInTheDocument();
    expect(countOrdersThisMonth).toHaveBeenCalledWith('p1', expect.any(Date));
  });

  it('counts the free orders used on a trial', async () => {
    await renderWith({ ...page, ordersPlaced: 5, ordersAtTrialReset: 4 });

    const meter = screen.getByText('Orders').closest('div')!;
    expect(within(meter).getByText('1 of 3 free orders used')).toBeInTheDocument();
  });

  it('says orders are paused once the free orders are used', async () => {
    await renderWith({ ...page, ordersPlaced: 3 });

    const meter = screen.getByText('Orders').closest('div')!;
    expect(within(meter).getByText('3 of 3 free orders used. Your shop takes no orders until you pay.')).toBeInTheDocument();
  });

  it('lists what Business includes, as the board does', async () => {
    await renderWith(page);

    const list = screen.getByRole('heading', { name: 'Included in Business' }).nextElementSibling!;
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Numbers from the chat', 'Your own shop', 'FAQ pages', 'Found in search']);
  });

  it('lists what has been paid, with a receipt for a paid one', async () => {
    process.env.BILLPLZ_BASE_URL = 'https://www.billplz-sandbox.com/';
    getRecentPayments.mockResolvedValue([
      {
        id: 'pay-1',
        plan: 'MONTHLY',
        amountCents: 4900,
        status: 'PAID',
        paidAt: new Date('2026-09-11T20:00:00.000Z'),
        grantedUntil: new Date('2026-10-12T00:00:00.000Z'),
        billplzBillId: 'abc123',
        createdAt: new Date('2026-09-11T10:00:00.000Z'),
      },
      {
        id: 'pay-2',
        plan: 'MONTHLY',
        amountCents: 4900,
        status: 'PENDING',
        paidAt: null,
        grantedUntil: null,
        billplzBillId: 'def456',
        createdAt: new Date('2026-09-10T10:00:00.000Z'),
      },
    ]);

    try {
      await renderWith(page);
    } finally {
      delete process.env.BILLPLZ_BASE_URL;
    }

    expect(screen.getByText('Receipts go to nadia@example.com')).toBeInTheDocument();
    const paid = screen.getByText('12 Sep 2026').closest('tr')!;
    expect(paid).toHaveTextContent('Business, 1 month');
    expect(paid).toHaveTextContent('RM49');
    expect(paid).toHaveTextContent('Paid');
    expect(within(paid).getByRole('link', { name: 'Receipt' })).toHaveAttribute('href', 'https://www.billplz-sandbox.com/bills/abc123');
    // A bill never paid has no receipt.
    const open = screen.getByText('10 Sep 2026').closest('tr')!;
    expect(open).toHaveTextContent('Not completed');
    expect(within(open).queryByRole('link')).toBeNull();
  });

  it('says there are no payments yet', async () => {
    await renderWith(page);

    expect(screen.getByText('No payments yet')).toBeInTheDocument();
  });


  it('offers the reset to a page that never paid and spent leads testing itself', async () => {
    await renderWith({ ...page, leadsCaptured: 3 });

    expect(ResetTrial).toHaveBeenCalledTimes(1);
  });

  it('offers the reset to a page that spent its orders and captured no leads', async () => {
    await renderWith({ ...page, ordersPlaced: 3 });

    expect(ResetTrial).toHaveBeenCalledTimes(1);
  });

  it('withholds the reset when every order is already counted by a reset', async () => {
    await renderWith({ ...page, ordersPlaced: 3, ordersAtTrialReset: 3 });

    expect(ResetTrial).not.toHaveBeenCalled();
  });

  it('withholds the reset once it has been used', async () => {
    await renderWith({
      ...page,
      leadsCaptured: 3,
      trialResetAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    // Offering a button the API answers 409 to is worse than offering none.
    expect(ResetTrial).not.toHaveBeenCalled();
  });

  it('withholds the reset from a page that has paid before', async () => {
    await renderWith({
      ...page,
      leadsCaptured: 3,
      paidUntil: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(ResetTrial).not.toHaveBeenCalled();
  });

  it('withholds the reset from a page with nothing to give back', async () => {
    await renderWith({ ...page, leadsCaptured: 0 });

    expect(ResetTrial).not.toHaveBeenCalled();
  });

  it('reads no usage or payments for a personal page', async () => {
    await renderWith({ ...page, mode: 'PERSONAL' });

    // Nothing to show, so nothing to ask the database for.
    expect(getConversationUsage).not.toHaveBeenCalled();
    expect(getRecentPayments).not.toHaveBeenCalled();
    expect(countLeadsThisMonth).not.toHaveBeenCalled();
    expect(countOrdersThisMonth).not.toHaveBeenCalled();
  });

  it('offers a personal page the upgrade, and says what changes', async () => {
    await renderWith({ ...page, mode: 'PERSONAL' });

    expect(UpgradeToBusiness).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: 'Selling something?' })).toBeInTheDocument();
    expect(screen.getByText(/appears in search results/)).toBeInTheDocument();
  });

  it('does not offer the upgrade to a business page', async () => {
    await renderWith(page);

    expect(UpgradeToBusiness).not.toHaveBeenCalled();
  });
});
