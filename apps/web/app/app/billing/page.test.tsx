import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';

const getOwnerPage = vi.fn();
vi.mock('@curios/db-read', () => ({ getOwnerPage }));

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

// PayButtons closes over apiFetch and window.location. These tests are about what the
// page decides to offer, so it records the options it was given instead.
const PayButtons = vi.fn((_props: { options: { plan: string; label: string }[] }) => null);
vi.mock('./pay-buttons.js', () => ({ PayButtons }));

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
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
  });

  it('offers both plans at their published prices to a business page', async () => {
    await renderWith(page);

    expect(screen.getByRole('heading', { name: 'Billing' })).toBeInTheDocument();
    expect(PayButtons).toHaveBeenCalledTimes(1);
    expect(PayButtons.mock.calls[0]?.[0].options).toEqual([
      { plan: 'MONTHLY', label: 'Pay RM39 for a month' },
      { plan: 'ANNUAL', label: 'Pay RM390 for a year' },
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
});
