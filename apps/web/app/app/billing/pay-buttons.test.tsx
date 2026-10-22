import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { PlanPay, payError, type PayOption } from './pay-buttons.js';

const options: PayOption[] = [
  { plan: 'MONTHLY', name: 'Monthly', price: 'RM49', note: 'One month at a time', period: 'a month', unit: 'month', afterShort: '14 Dec', afterLong: '14 Dec 2026', paidPct: 50 },
  { plan: 'ANNUAL', name: 'Yearly', price: 'RM490', note: 'Paid once a year', period: 'a year', unit: 'year', save: '2 months free', afterShort: '14 Nov 2027', afterLong: '14 Nov 2027', paidPct: 8 },
];

function pay(overrides: Partial<Parameters<typeof PlanPay>[0]> = {}) {
  const props = {
    options,
    onPay: vi.fn(async () => ({ url: 'https://gate.chip-in.asia/p/abc/' })),
    navigate: vi.fn(),
    ...overrides,
  };
  render(<PlanPay {...props} />);
  return props;
}

describe('PlanPay', () => {
  it('starts on Monthly, and Pay says the chosen price', async () => {
    pay();
    expect(screen.getByRole('radio', { name: /monthly/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Pay RM49' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /yearly/i }));
    expect(screen.getByRole('button', { name: 'Pay RM490' })).toBeInTheDocument();
  });

  it('says what is about to happen before opening CHIP', async () => {
    const { onPay, navigate } = pay();
    await userEvent.click(screen.getByRole('radio', { name: /yearly/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM490' }));

    const dialog = screen.getByRole('dialog', { name: 'Add a year' });
    expect(dialog).toHaveTextContent('Business, 1 year');
    expect(dialog).toHaveTextContent('Paid until becomes 14 Nov 2027');
    expect(onPay).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue to CHIP' }));
    expect(onPay).toHaveBeenCalledWith('ANNUAL', false);
    expect(navigate).toHaveBeenCalledWith('https://gate.chip-in.asia/p/abc/');
  });

  it('raises nothing when the owner backs out', async () => {
    const { onPay } = pay();
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onPay).not.toHaveBeenCalled();
  });

  it('cannot open two purchases from a double press', async () => {
    let finish = () => {};
    const onPay = vi.fn(
      () =>
        new Promise<{ url: string }>((resolve) => {
          finish = () => resolve({ url: 'https://gate.chip-in.asia/p/abc/' });
        }),
    );
    pay({ onPay });
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to CHIP' }));

    // The button is gone while the purchase is made: there is nothing to press twice.
    expect(screen.queryByRole('button', { name: 'Continue to CHIP' })).toBeNull();
    expect(screen.getByText('Opening CHIP…')).toBeInTheDocument();
    expect(onPay).toHaveBeenCalledTimes(1);
    finish();
  });

  it('says CHIP is not answering when the API reports it by code, and lets the owner try again', async () => {
    // The API replaces a 502's message with its generic sentence, so the code is all that
    // arrives. This screen supplies the words.
    const onPay = vi.fn(async (): Promise<{ url: string }> => {
      throw new ApiError(502, 'CHIP_UNAVAILABLE', 'Something failed on our side. Try again.');
    });
    pay({ onPay });
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to CHIP' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('CHIP is not answering right now. Try again in a few minutes.');
    expect(screen.getByRole('button', { name: 'Continue to CHIP' })).toBeInTheDocument();
  });

  it('pays with auto-renew when the box is ticked', async () => {
    const { onPay } = pay();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Renew automatically by card' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to CHIP' }));

    expect(onPay).toHaveBeenCalledWith('MONTHLY', true);
  });

  it('says what the box does, and leaves it unticked', () => {
    pay();
    expect(screen.getByRole('checkbox', { name: 'Renew automatically by card' })).not.toBeChecked();
    expect(screen.getByText('We’ll charge your card when this period ends. Turn it off any time.')).toBeInTheDocument();
    expect(screen.getByText(/FPX, card or e-wallet, through CHIP\./)).toBeInTheDocument();
  });

  it('says the card-only route when ticked', async () => {
    pay();
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('You’ll go to CHIP to pay by FPX, card or e-wallet, then come straight back here.');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getByRole('checkbox', { name: 'Renew automatically by card' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('You’ll go to CHIP to pay by card, then come straight back here.');
  });

  it('names CHIP in the dialog and the busy state', async () => {
    pay({ onPay: vi.fn(() => new Promise<{ url: string }>(() => {})) });
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to CHIP' }));

    expect(screen.getByText('Opening CHIP…')).toBeInTheDocument();
    expect(screen.getByText('CHIP’s payment page opens next.')).toBeInTheDocument();
  });

  it('draws the line from today to where this payment takes it', () => {
    pay({ timeline: { today: '15 Oct', paidUntil: '14 Nov' } });
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('14 Nov')).toBeInTheDocument();
    expect(screen.getByText('14 Dec')).toBeInTheDocument();
  });
});

describe('payError', () => {
  // Development without CHIP settings. A 503, so again only the code arrives.
  it('says payments are switched off when billing is not configured', () => {
    const failure = new ApiError(503, 'BILLING_NOT_CONFIGURED', 'Something failed on our side. Try again.');

    expect(payError(failure)).toBe(
      'Payments are switched off here: no CHIP settings in this environment.',
    );
  });

  it('passes any other API message through unchanged', () => {
    expect(payError(new ApiError(429, 'RATE_LIMITED', 'Too many payment attempts. Try again in 1 hour.'))).toBe(
      'Too many payment attempts. Try again in 1 hour.',
    );
  });
});
