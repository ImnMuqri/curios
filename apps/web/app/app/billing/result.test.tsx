import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { PaymentResult } from '@curios/db-read';

const getOwnerPage = vi.fn();
const getPaymentResult = vi.fn();
vi.mock('@curios/db-read', () => ({ getOwnerPage, getPaymentResult }));

const resolveOwner = vi.fn();
vi.mock('../session.js', () => ({ resolveOwner }));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'a-session-value' }) }),
}));

// Throws, as the real `redirect` does: a mock that only recorded the call would let the
// page carry on past a redirect it must not survive.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

const PaidPage = (await import('./paid/page.js')).default;
const FailedPage = (await import('./failed/page.js')).default;

const result: PaymentResult = {
  plan: 'MONTHLY',
  amountCents: 4900,
  status: 'PAID',
  paidVia: 'FPX · Maybank2u',
  reference: 'A1B2C3D4',
  grantedUntil: new Date('2026-12-14T00:00:00Z'),
  autoRenew: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveOwner.mockResolvedValue({ accountId: 'a1', name: 'Lina binti Kamal', email: 'lina@example.com' });
  getOwnerPage.mockResolvedValue({ id: 'p1', paidUntil: null });
  getPaymentResult.mockResolvedValue(result);
});

const paid = async (query: { payment?: string; card?: string } = { payment: 'pay_1' }) => render(await PaidPage({ searchParams: Promise.resolve(query) }));
const failed = async (query: { payment?: string; reason?: string } = { payment: 'pay_1', reason: 'cancelled' }) =>
  render(await FailedPage({ searchParams: Promise.resolve(query) }));

describe('the paid page', () => {
  it('welcomes the owner by first name, with the date, the receipt and the way on', async () => {
    await paid();

    expect(screen.getByText('Payment received')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome to Business, Lina.');
    expect(screen.getByText('14 Dec 2026')).toBeInTheDocument();
    expect(screen.getByText(/Nothing renews by itself\./)).toBeInTheDocument();
    const receipt = screen.getByText('Business, 1 month').closest('dl')!;
    expect(within(receipt).getByText('RM49.00')).toBeInTheDocument();
    expect(within(receipt).getByText('Paid with')).toBeInTheDocument();
    expect(within(receipt).getByText('FPX · Maybank2u')).toBeInTheDocument();
    expect(within(receipt).getByText('A1B2C3D4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to dashboard' })).toHaveAttribute('href', '/app');
    expect(screen.getByText('CHIP emails your receipt to lina@example.com.')).toBeInTheDocument();
    expect(getPaymentResult).toHaveBeenCalledWith('p1', 'pay_1');
  });

  it('says when it renews by itself', async () => {
    getPaymentResult.mockResolvedValue({ ...result, autoRenew: true });

    await paid();

    expect(screen.getByText(/Renews by itself on 14 Dec 2026\./)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing renews by itself/)).toBeNull();
  });

  it('says so when auto-renew was asked for and CHIP kept no card (card=off)', async () => {
    getPaymentResult.mockResolvedValue({ ...result, autoRenew: true });

    await paid({ payment: 'pay_1', card: 'off' });

    expect(screen.getByText(/auto-renew couldn’t be turned on for this payment/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing renews by itself\./)).toBeInTheDocument();
  });

  it('says nothing about a card on a hand-typed card=off for a payment that never asked for one', async () => {
    await paid({ payment: 'pay_1', card: 'off' });

    expect(screen.queryByText(/auto-renew couldn’t be turned on/)).toBeNull();
  });

  it('prices a year as a year', async () => {
    getPaymentResult.mockResolvedValue({ ...result, plan: 'ANNUAL', amountCents: 49000 });

    await paid();

    expect(screen.getByText('Business, 1 year')).toBeInTheDocument();
    expect(screen.getByText('RM490.00')).toBeInTheDocument();
  });

  it('sends a payment that is not the owner’s to Billing', async () => {
    getPaymentResult.mockResolvedValue(null);

    await expect(paid({ payment: 'someone-elses' })).rejects.toThrow('NEXT_REDIRECT:/app/billing');
    expect(getPaymentResult).toHaveBeenCalledWith('p1', 'someone-elses');
  });

  it('sends a visit with no payment id to Billing', async () => {
    await expect(paid({})).rejects.toThrow('NEXT_REDIRECT:/app/billing');
    expect(getPaymentResult).not.toHaveBeenCalled();
  });

  it('sends a payment not yet granted to Billing, which says it is confirming', async () => {
    getPaymentResult.mockResolvedValue({ ...result, status: 'PENDING', grantedUntil: null });

    await expect(paid()).rejects.toThrow('NEXT_REDIRECT:/app/billing?payment=pending');
  });

  it('sends a signed-out visitor to sign in', async () => {
    resolveOwner.mockResolvedValue(null);

    await expect(paid()).rejects.toThrow('NEXT_REDIRECT:/signin');
  });
});

describe('the failed page', () => {
  const tried = { ...result, status: 'FAILED' as const, grantedUntil: null, reference: null };
  beforeEach(() => getPaymentResult.mockResolvedValue(tried));

  it('says nothing was charged, what happened, and offers the pay sheet twice over', async () => {
    await failed();

    expect(screen.getByText('Not charged')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('That didn’t go through.');
    const receipt = screen.getByText('What happened').closest('dl')!;
    expect(within(receipt).getByText('Cancelled at bank')).toBeInTheDocument();
    expect(within(receipt).getByText('RM49.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/app/billing?pay=1');
    expect(screen.getByRole('link', { name: 'Pick another bank' })).toHaveAttribute('href', '/app/billing?pay=1');
    // Outside the frame (no Help panel) it emails support; in the dashboard it opens the panel.
    expect(screen.getByRole('link', { name: 'Ask for help' })).toHaveAttribute('href', 'mailto:support@curios.my');
  });

  it.each([
    ['expired', 'Took too long'],
    ['declined', 'Bank declined'],
    ['unfinished', 'Didn’t finish'],
  ])('reads reason=%s as "%s"', async (reason, words) => {
    await failed({ payment: 'pay_1', reason });

    expect(screen.getByText(words.replace('’', "'"))).toBeInTheDocument();
  });

  it('reads a reason we never send as unfinished', async () => {
    await failed({ payment: 'pay_1', reason: '<script>' });

    expect(screen.getByText('Didn\'t finish')).toBeInTheDocument();
  });

  it('says what the plan still covers, when it still covers something', async () => {
    getOwnerPage.mockResolvedValue({ id: 'p1', paidUntil: new Date(Date.now() + 5 * 86_400_000) });

    await failed();

    expect(screen.getByText(/Your plan is still fine until/)).toBeInTheDocument();
  });

  it('says nothing of the plan when it has ended', async () => {
    await failed();

    expect(screen.queryByText(/Your plan is still fine/)).toBeNull();
  });

  it('shows how it was tried only when CHIP said', async () => {
    getPaymentResult.mockResolvedValue({ ...tried, paidVia: null });

    await failed();

    expect(screen.queryByText('Tried with')).toBeNull();
  });

  it('sends a payment that is not the owner’s to Billing', async () => {
    getPaymentResult.mockResolvedValue(null);

    await expect(failed({ payment: 'someone-elses', reason: 'cancelled' })).rejects.toThrow('NEXT_REDIRECT:/app/billing');
  });

  it('sends a payment that did get paid to Billing, with nothing to explain', async () => {
    getPaymentResult.mockResolvedValue(result);

    await expect(failed()).rejects.toThrow('NEXT_REDIRECT:/app/billing');
  });
});

describe('result.module.css', () => {
  // Compound selectors win over bare ones, so the reduced-motion block must name every
  // animated selector exactly as it was declared, or Peek keeps moving.
  it('stops every selector that sets an animation under prefers-reduced-motion', () => {
    const source = readFileSync(join(import.meta.dirname, 'result.module.css'), 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const reducedAt = source.indexOf('@media (prefers-reduced-motion: reduce)');
    expect(reducedAt).toBeGreaterThan(-1);
    const reduced = source.slice(reducedAt);
    const stopped = new Set(
      [...reduced.matchAll(/([^{}]+)\{\s*animation:\s*none;?\s*\}/g)].flatMap((m) => m[1]!.split(',').map((sel) => sel.trim())),
    );
    const rest = source.slice(0, reducedAt).replace(/@keyframes\s+\w+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '');
    const animated = [...rest.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
      .filter((m) => /(^|[;\s])animation\s*:/.test(m[2]!) && !/animation:\s*none/.test(m[2]!))
      .flatMap((m) => m[1]!.split(',').map((sel) => sel.trim()));

    expect(animated.length).toBeGreaterThan(8);
    expect(animated.filter((sel) => !stopped.has(sel))).toEqual([]);
  });
});
