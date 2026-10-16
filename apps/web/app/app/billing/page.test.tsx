import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';

const getOwnerPage = vi.fn();
const getConversationUsage = vi.fn();
const getRecentPayments = vi.fn();
vi.mock('@curios/db-read', () => ({ getOwnerPage, getConversationUsage, getRecentPayments }));

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
const PayButtons = vi.fn((_props: { options: { plan: string; label: string }[] }) => null);
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
  trialResetAt: null,
  allowSearchIndexing: false,
  avatarKey: null,
};

async function renderWith(owned: OwnerPage | null, payment?: string) {
  getOwnerPage.mockResolvedValueOnce(owned);
  render(await BillingPage({ searchParams: Promise.resolve({ payment }) }));
}

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
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
  });

  it('offers both plans at their published prices to a business page', async () => {
    await renderWith(page);

    expect(screen.getByRole('heading', { name: 'Billing' })).toBeInTheDocument();
    // Fix round 2, Important #3: AppFrame renders its own main around every
    // screen it wraps, this one included, so a second one here would nest.
    expect(screen.queryByRole('main')).toBeNull();
    expect(PayButtons).toHaveBeenCalledTimes(1);
    // Each a plan card now, the yearly one featured; the button words still say exactly what happens.
    expect(PayButtons.mock.calls[0]?.[0].options).toEqual([
      expect.objectContaining({ plan: 'MONTHLY', label: 'Pay RM39 for a month', price: 'RM39', per: 'a month' }),
      expect.objectContaining({ plan: 'ANNUAL', label: 'Pay RM390 for a year', price: 'RM390', per: 'a year', featured: true }),
    ]);
  });

  it('offers nothing to pay for on a personal page', async () => {
    await renderWith({ ...page, mode: 'PERSONAL' });

    expect(PayButtons).not.toHaveBeenCalled();
    expect(screen.getByText('Personal pages are free. There is nothing to pay for.')).toBeInTheDocument();
  });

  it('shows the banner the API redirected back with', async () => {
    await renderWith(page, 'paid');

    expect(screen.getByRole('status')).toHaveTextContent('Payment received. Your plan is active.');
  });

  it('sends an owner with no page to onboarding', async () => {
    await expect(renderWith(null)).rejects.toThrow('NEXT_REDIRECT:/app/onboarding');
  });

  it('shows this month’s usage against the cap', async () => {
    await renderWith(page);

    expect(screen.getByText('12 of 200 conversations used this month.')).toBeInTheDocument();
    expect(getConversationUsage).toHaveBeenCalledWith('p1', expect.any(Date));
  });

  it('lists what has been paid', async () => {
    getRecentPayments.mockResolvedValue([
      {
        id: 'pay-1',
        plan: 'MONTHLY',
        amountCents: 3900,
        status: 'PAID',
        paidAt: new Date('2026-09-11T20:00:00.000Z'),
        grantedUntil: new Date('2026-10-12T00:00:00.000Z'),
        createdAt: new Date('2026-09-11T10:00:00.000Z'),
      },
    ]);

    await renderWith(page);

    // A table row: when, what, and whether it went through.
    const row = screen.getByText('12 September 2026').closest('li')!;
    expect(row).toHaveTextContent('RM39 for a month');
    expect(row).toHaveTextContent('Covers you until 12 October 2026');
    expect(row).toHaveTextContent('Paid');
  });

  it('offers the reset to a page that never paid and spent leads testing itself', async () => {
    await renderWith({ ...page, leadsCaptured: 3 });

    expect(ResetTrial).toHaveBeenCalledTimes(1);
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
