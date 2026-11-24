import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';
import { defaultSettings } from '@curios/core/settings';
import { raisedSettings } from '@curios/core/test-settings';

const getOwnerPage = vi.fn();
const getConversationUsage = vi.fn();
const getRecentPayments = vi.fn();
const countLeadsThisMonth = vi.fn();
const countOrdersThisMonth = vi.fn();
const getSignInMethods = vi.fn();
const getRenewalCard = vi.fn();
const getSettings = vi.fn();
const getPaymentResult = vi.fn();
vi.mock('@curios/db-read', () => ({ getOwnerPage, getRenewalCard, getConversationUsage, getRecentPayments, countLeadsThisMonth, countOrdersThisMonth, getSignInMethods, getSettings, getPaymentResult }));

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
vi.mock('next/navigation', () => ({ redirect, useSearchParams: () => new URLSearchParams() }));

// Both client components are recorded rather than rendered: these tests are
// about what the page decides to offer, not about what those two do with it.
const PayButtons = vi.fn((_props: { options: Record<string, unknown>[]; initialOpen?: boolean }) => null);
vi.mock('./pay-buttons.js', () => ({ PayButtons }));
const AutoRenew = vi.fn((_props: { card: Record<string, unknown> | null; canPay: boolean }) => null);
vi.mock('./auto-renew.js', () => ({ AutoRenew }));
const PaymentToast = vi.fn((_props: { notice: Record<string, unknown> | null; canPay: boolean }) => null);
vi.mock('./payment-toast.js', () => ({ PaymentToast }));
vi.mock('../../_peek/LivePeek.js', () => ({ LivePeek: () => null }));
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
  suspendedAt: null,
  suspendReason: null,
  mode: 'BUSINESS',
  paidUntil: null,
  leadsCaptured: 0,
  ordersPlaced: 0,
  ordersAtTrialReset: 0,
  trialResetAt: null,
  storeEnabled: false,
  allowSearchIndexing: false,
  avatarKey: null,
  chipRefused: false,
  payByQr: true,
};

async function renderWith(owned: OwnerPage | null, payment?: string, pay?: string, more: { paid?: string; failed?: string; checking?: string } = {}) {
  getOwnerPage.mockResolvedValueOnce(owned);
  render(await BillingPage({ searchParams: Promise.resolve({ payment, pay, ...more }) }));
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
    AutoRenew.mockClear();
    PaymentToast.mockClear();
    getPaymentResult.mockReset();
    getPaymentResult.mockResolvedValue(null);
    getRenewalCard.mockReset();
    getRenewalCard.mockResolvedValue(null);
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
    getSettings.mockReset();
    getSettings.mockResolvedValue(defaultSettings());
  });

  it('says online payments are paused, in place of the pay buttons, while CHIP payments are off', async () => {
    const off = defaultSettings();
    off.switches.chipPayments = false;
    getSettings.mockResolvedValue(off);
    await renderWith(page);

    expect(screen.getByText('Online payments are paused for a moment. Try again soon.')).toBeInTheDocument();
    expect(PayButtons).not.toHaveBeenCalled();
  });

  it('offers the pay buttons again once CHIP payments are back on, with no paused line', async () => {
    await renderWith(page);

    expect(PayButtons).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Online payments are paused for a moment. Try again soon.')).toBeNull();
  });

  it('offers both plans at their published prices to a business page', async () => {
    await renderWith(page);

    expect(screen.getByRole('heading', { name: 'Billing' })).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Your plan, this month\u2019s usage and what you have paid.')).toBeInTheDocument();
    // Fix round 2, Important #3: AppFrame renders its own main around every
    // screen it wraps, this one included, so a second one here would nest.
    expect(screen.queryByRole('main')).toBeNull();
    expect(PayButtons).toHaveBeenCalledTimes(1);
    expect(PayButtons.mock.calls[0]?.[0].options).toEqual([
      expect.objectContaining({ plan: 'MONTHLY', name: 'Monthly', price: 'RM49', note: 'One month at a time', period: 'a month' }),
      expect.objectContaining({ plan: 'ANNUAL', name: 'Yearly', price: 'RM490', note: 'Paid once a year', period: 'a year', save: '2 months free' }),
    ]);
  });

  describe('with the prices and allowances the admin set', () => {
    /** The shared fixture: price.MONTHLY at 5900, five free leads and five free orders. */
    const live = () => raisedSettings({ freeLeads: 5, freeOrders: 5 });

    it('offers the plans at the prices in force, and claims no months free the prices do not give', async () => {
      getSettings.mockResolvedValue(live());
      await renderWith(page);

      const [monthly, annual] = PayButtons.mock.calls[0]?.[0].options ?? [];
      expect(monthly).toMatchObject({ plan: 'MONTHLY', price: 'RM59' });
      expect(annual).toMatchObject({ plan: 'ANNUAL', price: 'RM490' });
      expect(annual?.save).toBeUndefined();
    });

    it('counts the trial and the shop against the allowances in force', async () => {
      getSettings.mockResolvedValue(live());
      await renderWith({ ...page, leadsCaptured: 1, ordersPlaced: 1 });

      expect(screen.getByText('1 of 5 used')).toBeInTheDocument();
      expect(screen.getByText(/Your first 5 numbers are free too/)).toBeInTheDocument();
      expect(within(screen.getByText('Orders').closest('div')!.parentElement!).getByText('1 of 5 free orders used')).toBeInTheDocument();
      expect(screen.getByText('4 of your 5 free leads left. After that, the capture card needs a plan.')).toBeInTheDocument();
    });

    it('tells a personal page the price and the free leads in force', async () => {
      getSettings.mockResolvedValue(live());
      await renderWith({ ...page, mode: 'PERSONAL' });

      expect(screen.getByText('Business gives you 5 free leads, then RM59 a month.')).toBeInTheDocument();
    });

    it('quotes a saved card the price in force, which the renewal will charge', async () => {
      getSettings.mockResolvedValue(live());
      getRenewalCard.mockResolvedValue({ plan: 'MONTHLY', cardLabel: 'Visa ending 1111', failedAttempts: 0 });
      await renderWith({ ...page, paidUntil: new Date('2099-01-01T00:00:00.000Z') });

      expect(AutoRenew.mock.calls[0]?.[0].card).toMatchObject({ price: 'RM59' });
    });
  });

  it('says the days a paid plan has left, with a plain bar, and no timeline', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-15T04:00:00.000Z'), toFake: ['Date'] });
    try {
      await renderWith({ ...page, paidUntil: new Date('2026-11-14T04:00:00.000Z') });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.getByText('Your plan')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Business' })).toBeInTheDocument();
    expect(screen.getByText('30 days left. Paid until 14 Nov 2026. No auto-renew, so nothing is charged without you.')).toBeInTheDocument();
    // The old count-up, plan badge and Today / Paid until / After this payment line are gone.
    expect(screen.queryByText('Business · free trial')).toBeNull();
    expect(screen.queryByText('After this payment')).toBeNull();
    const props = PayButtons.mock.calls[0]?.[0];
    expect(props).not.toHaveProperty('timeline');
    // Paying adds to the time already paid for; the dialog says where it lands.
    expect(props?.options[0]).toMatchObject({ afterLong: '14 December 2026' });
    expect(props?.options[1]).toMatchObject({ afterLong: '14 November 2027' });
  });

  it('says a card renews it, when one is saved', async () => {
    getRenewalCard.mockResolvedValue({ cardLabel: 'Visa ending 4242', plan: 'MONTHLY', failedAttempts: 0 });
    vi.useFakeTimers({ now: new Date('2026-10-15T04:00:00.000Z'), toFake: ['Date'] });
    try {
      await renderWith({ ...page, paidUntil: new Date('2026-11-14T04:00:00.000Z') });
    } finally {
      vi.useRealTimers();
    }

    expect(screen.getByText('30 days left. Paid until 14 Nov 2026. Renews by card on 14 Nov 2026.')).toBeInTheDocument();
  });

  it('counts the free leads left on a trial, one segment each', async () => {
    await renderWith({ ...page, leadsCaptured: 1 });

    expect(screen.getByText(/^2 free leads left\. Answering is free forever/)).toBeInTheDocument();
    expect(screen.getByText('1 of 3 used')).toBeInTheDocument();
  });

  it('offers nothing to pay for on a personal page', async () => {
    await renderWith({ ...page, mode: 'PERSONAL' });

    expect(PayButtons).not.toHaveBeenCalled();
    // The board's card, with no plan card beside it.
    expect(screen.getByText('This is a personal page. It answers questions about you. A business page takes numbers and runs a shop.')).toBeInTheDocument();
    expect(screen.queryByText('Your plan')).toBeNull();
    expect(screen.queryByText('Payments')).toBeNull();
  });

  it('says nothing for ?payment=paid: a hand-typed value must not claim a payment', async () => {
    await renderWith({ ...page, paidUntil: new Date('2026-12-14T00:00:00Z') }, 'paid');

    expect(screen.queryByRole('status')).toBeNull();
    expect(PaymentToast.mock.calls[0]?.[0].notice).toBeNull();
  });

  it('gives the toast what the payment record says, never what the query says', async () => {
    getPaymentResult.mockResolvedValue({
      plan: 'MONTHLY',
      amountCents: 4900,
      status: 'PAID',
      paidVia: null,
      reference: null,
      grantedUntil: new Date('2027-01-02T04:00:00.000Z'),
      autoRenew: false,
    });
    await renderWith(page, undefined, undefined, { paid: 'pay-1' });

    // Looked up for this owner's page only.
    expect(getPaymentResult).toHaveBeenCalledWith('p1', 'pay-1');
    expect(PaymentToast.mock.calls[0]?.[0].notice).toEqual({ kind: 'paid', title: 'Paid RM49', sub: 'Business runs until 2 Jan 2027', note: null });
  });

  it('says checking, not Paid, while a ?paid payment is still pending in the record', async () => {
    getPaymentResult.mockResolvedValue({ plan: 'MONTHLY', amountCents: 4900, status: 'PENDING', paidVia: null, reference: null, grantedUntil: null, autoRenew: false });
    await renderWith(page, undefined, undefined, { paid: 'pay-1' });

    expect(PaymentToast.mock.calls[0]?.[0].notice).toMatchObject({ kind: 'checking' });
  });

  it('shows the failed toast for ?failed', async () => {
    getPaymentResult.mockResolvedValue({ plan: 'MONTHLY', amountCents: 4900, status: 'FAILED', paidVia: null, reference: null, grantedUntil: null, autoRenew: false });
    await renderWith(page, undefined, undefined, { failed: 'pay-2' });

    expect(PaymentToast.mock.calls[0]?.[0].notice).toMatchObject({ kind: 'failed', sub: 'Nothing was charged' });
  });

  it('shows the checking toast for ?checking while the record is pending', async () => {
    getPaymentResult.mockResolvedValue({ plan: 'MONTHLY', amountCents: 4900, status: 'PENDING', paidVia: null, reference: null, grantedUntil: null, autoRenew: false });
    await renderWith(page, undefined, undefined, { checking: 'pay-3' });

    expect(PaymentToast.mock.calls[0]?.[0].notice).toMatchObject({ kind: 'checking' });
  });

  it('shows no toast for a payment that is not this owner\'s', async () => {
    getPaymentResult.mockResolvedValue(null);
    await renderWith(page, undefined, undefined, { paid: 'someone-elses' });

    expect(PaymentToast.mock.calls[0]?.[0].notice).toBeNull();
  });

  it('says the card was not kept from its own records: auto-renew asked for and no saved card', async () => {
    const result = { plan: 'MONTHLY', amountCents: 4900, status: 'PAID', paidVia: null, reference: null, grantedUntil: new Date('2027-01-02T04:00:00.000Z'), autoRenew: true };
    getPaymentResult.mockResolvedValue(result);
    await renderWith(page, undefined, undefined, { paid: 'pay-1' });
    expect(PaymentToast.mock.calls[0]?.[0].notice).toMatchObject({ kind: 'paid', note: expect.stringContaining('auto-renew couldn\u2019t be turned on') });

    // A card is saved: nothing to say. The address cannot make it say otherwise.
    PaymentToast.mockClear();
    getRenewalCard.mockResolvedValue({ cardLabel: 'Visa ending 4242', plan: 'MONTHLY', failedAttempts: 0 });
    await renderWith(page, undefined, undefined, { paid: 'pay-1', card: 'off' } as never);
    expect(PaymentToast.mock.calls[0]?.[0].notice).toMatchObject({ kind: 'paid', note: null });
  });

  it('tells the toast whether online payments are on, so Try again is not offered when they are off', async () => {
    await renderWith(page);
    expect(PaymentToast.mock.calls[0]?.[0].canPay).toBe(true);

    PaymentToast.mockClear();
    const off = defaultSettings();
    off.switches.chipPayments = false;
    getSettings.mockResolvedValue(off);
    await renderWith(page);
    expect(PaymentToast.mock.calls[0]?.[0].canPay).toBe(false);
  });

  it('opens the pay sheet on arrival for ?pay=1, and not otherwise', async () => {
    await renderWith(page, undefined, '1');
    expect(PayButtons.mock.calls[0]?.[0]).toMatchObject({ initialOpen: true });

    PayButtons.mockClear();
    await renderWith(page);
    expect(PayButtons.mock.calls[0]?.[0]).toMatchObject({ initialOpen: false });
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

    // The board has no "This month" heading; it is there for a screen reader only.
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

    const meter = screen.getByText('Leads').closest('div')!.parentElement!;
    expect(meter).toHaveTextContent('2 · no limit');
    expect(within(meter).getByText('The capture card stays on your page.')).toBeInTheDocument();
    expect(countLeadsThisMonth).toHaveBeenCalledWith('p1', expect.any(Date));
  });

  it('counts this month’s orders on a paid page, saying there is no limit under it (owner, 12 Nov 2026)', async () => {
    await renderWith({ ...page, paidUntil: new Date('2099-01-01T00:00:00.000Z'), ordersPlaced: 40 });

    const meter = screen.getByText('Orders').closest('div')!.parentElement!;
    expect(meter).toHaveTextContent('7 · no limit');
    expect(within(meter).getByText('Take as many as you get.')).toBeInTheDocument();
    expect(countOrdersThisMonth).toHaveBeenCalledWith('p1', expect.any(Date));
  });

  it('counts the free orders used on a trial', async () => {
    await renderWith({ ...page, ordersPlaced: 5, ordersAtTrialReset: 4 });

    const meter = screen.getByText('Orders').closest('div')!.parentElement!;
    expect(within(meter).getByText('1 of 3 free orders used')).toBeInTheDocument();
  });

  it('says orders are paused once the free orders are used', async () => {
    await renderWith({ ...page, ordersPlaced: 3 });

    const meter = screen.getByText('Orders').closest('div')!.parentElement!;
    expect(within(meter).getByText('3 of 3 free orders used. Your shop takes no orders until you pay.')).toBeInTheDocument();
  });

  it('says orders are paused since the plan ended, once the free orders are used too', async () => {
    await renderWith({ ...page, paidUntil: new Date('2026-10-14T04:00:00.000Z'), ordersPlaced: 5, leadsCaptured: 3 });

    const meter = screen.getByText('Orders').closest('div')!.parentElement!;
    expect(meter).toHaveTextContent('this month');
    expect(within(meter).getByText('Your plan ended on 14 Oct 2026. Your shop takes no orders until you pay.')).toBeInTheDocument();
  });

  it('draws a bar for the conversations only: orders and leads have no cap to fill', async () => {
    await renderWith({ ...page, paidUntil: new Date('2099-01-01T00:00:00.000Z') });

    // The conversations' bar is the only toned one; the plan card's bar has no tone.
    const month = screen.getByRole('region', { name: 'This month' });
    expect(month.querySelectorAll('[data-tone]')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Included in Business' })).toBeNull();
    expect(screen.queryByText('Numbers from the chat')).toBeNull();
  });

  const row = {
    plan: 'MONTHLY' as const,
    amountCents: 4900,
    provider: 'CHIP' as const,
    autoRenewal: false,
    paidAt: null,
    grantedUntil: null,
  };
  const paidRow = {
    ...row,
    id: 'pay-1',
    status: 'PAID' as const,
    paidAt: new Date('2026-09-11T20:00:00.000Z'),
    grantedUntil: new Date('2026-10-12T00:00:00.000Z'),
    createdAt: new Date('2026-09-11T10:00:00.000Z'),
  };

  it('lists what has been paid, and who gets the receipt', async () => {
    getRecentPayments.mockResolvedValue([paidRow, { ...row, id: 'pay-2', status: 'PENDING', createdAt: new Date('2026-09-10T10:00:00.000Z') }]);

    await renderWith(page);

    expect(screen.getByText('Receipts go to nadia@example.com')).toBeInTheDocument();
    expect([...document.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Date', 'What for', 'Status', 'Amount']);
    const paid = screen.getByText('12 Sep 2026').closest('tr')!;
    expect(paid).toHaveTextContent('Business, 1 month');
    expect(paid).toHaveTextContent('RM49');
    expect(paid).toHaveTextContent('Paid');
    const open = screen.getByText('10 Sep 2026').closest('tr')!;
    expect(open).toHaveTextContent('Not completed');
  });

  it('has no receipt link, because CHIP emails the receipt', async () => {
    getRecentPayments.mockResolvedValue([paidRow]);

    await renderWith(page);

    expect(screen.queryByRole('link', { name: 'Receipt' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Receipt' })).toBeNull();
  });

  it('lists a declined renewal as Declined', async () => {
    getRecentPayments.mockResolvedValue([{ ...row, id: 'pay-3', autoRenewal: true, status: 'FAILED', createdAt: new Date('2026-09-12T10:00:00.000Z') }]);

    await renderWith(page);

    const declined = screen.getByText('12 Sep 2026').closest('tr')!;
    expect(declined).toHaveTextContent('Auto-renewal');
    expect(declined).toHaveTextContent('Declined');
  });

  it('shows auto-renew as its own card, above the plan, with a saved card as plain data', async () => {
    getRenewalCard.mockResolvedValue({ cardLabel: 'Visa ending 4242', plan: 'ANNUAL', failedAttempts: 0 });

    await renderWith({ ...page, paidUntil: new Date('2026-12-14T00:00:00Z') });

    expect(AutoRenew).toHaveBeenCalledTimes(1);
    expect(AutoRenew.mock.calls[0]?.[0].card).toEqual({
      label: 'Visa ending 4242',
      price: 'RM490',
      paidUntil: '14 Dec 2026',
      failed: false,
      ended: false,
    });
    expect(AutoRenew.mock.calls[0]?.[0].canPay).toBe(true);
    expect(screen.queryByText(/No auto-renew/)).toBeNull();
  });

  it('flags a card whose last renewal failed', async () => {
    getRenewalCard.mockResolvedValue({ cardLabel: null, plan: 'MONTHLY', failedAttempts: 2 });

    await renderWith({ ...page, paidUntil: new Date('2026-12-14T00:00:00Z') });

    expect(AutoRenew.mock.calls[0]?.[0].card).toMatchObject({ label: null, price: 'RM49', failed: true });
  });

  it('keeps the auto-renew card mounted with no card, so it can say it is off', async () => {
    await renderWith({ ...page, paidUntil: new Date('2026-12-14T00:00:00Z') });

    expect(AutoRenew).toHaveBeenCalledTimes(1);
    expect(AutoRenew.mock.calls[0]?.[0].card).toBeNull();
    expect(screen.getByText(/No auto-renew, so nothing is charged without you\./)).toBeInTheDocument();
  });

  it('takes Pay another way away while online payments are paused', async () => {
    const off = defaultSettings();
    off.switches.chipPayments = false;
    getSettings.mockResolvedValue(off);
    getRenewalCard.mockResolvedValue({ cardLabel: null, plan: 'MONTHLY', failedAttempts: 1 });

    await renderWith({ ...page, paidUntil: new Date('2026-12-14T00:00:00Z') });

    expect(AutoRenew.mock.calls[0]?.[0].canPay).toBe(false);
  });

  it('keeps the turn-off on a lapsed page with a card, so the next try can still be stopped', async () => {
    // The job charges up to 3 days after paidUntil; the Terms say the owner can stop it.
    vi.useFakeTimers({ now: new Date('2026-10-13T04:00:00.000Z'), toFake: ['Date'] });
    try {
      getRenewalCard.mockResolvedValue({ cardLabel: 'Visa ending 4242', plan: 'MONTHLY', failedAttempts: 1 });

      await renderWith({ ...page, paidUntil: new Date('2026-10-12T00:00:00Z'), leadsCaptured: 10 });

      expect(AutoRenew).toHaveBeenCalledTimes(1);
      expect(AutoRenew.mock.calls[0]?.[0].card).toEqual({
        label: 'Visa ending 4242',
        price: 'RM49',
        paidUntil: '12 Oct 2026',
        failed: true,
        ended: true,
      });
    } finally {
      vi.useRealTimers();
    }
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
    expect(screen.getByText('Selling something?')).toBeInTheDocument();
    expect(screen.getByText('This is a personal page. It answers questions about you. A business page takes numbers and runs a shop.')).toBeInTheDocument();
  });

  it('does not offer the upgrade to a business page', async () => {
    await renderWith(page);

    expect(UpgradeToBusiness).not.toHaveBeenCalled();
  });
});
