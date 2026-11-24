import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { PayButtons, PlanPay, payError, type PayOption } from './pay-buttons.js';
import { PayDialogProvider, usePayDialog } from './pay-context.js';

const options: PayOption[] = [
  { plan: 'MONTHLY', name: 'Monthly', price: 'RM49', note: 'One month at a time', period: 'a month', unit: 'month', afterLong: '14 December 2026' },
  { plan: 'ANNUAL', name: 'Yearly', price: 'RM490', note: 'Paid once a year', period: 'a year', unit: 'year', save: '2 months free', afterLong: '14 November 2027' },
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
    expect(dialog).toHaveTextContent('Paid until becomes 14 November 2027');
    expect(onPay).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue to CHIP' }));
    expect(onPay).toHaveBeenCalledWith('ANNUAL', false);
    expect(navigate).toHaveBeenCalledWith('https://gate.chip-in.asia/p/abc/');
  });

  it('starts with the dialog open when asked to, as Try again lands on it', () => {
    render(<PayButtons options={options} initialOpen />);

    expect(screen.getByRole('dialog', { name: 'Add a month' })).toHaveTextContent('Business, 1 month');
  });

  it('raises nothing when the owner backs out', async () => {
    const { onPay } = pay();
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Renew automatically by card' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to CHIP' }));

    expect(onPay).toHaveBeenCalledWith('MONTHLY', true);
  });

  it('keeps the box in the dialog, says what it does, and leaves it unticked', async () => {
    pay();
    // Not on the plan card any more: it is asked for with the payment, in the dialog.
    expect(screen.queryByRole('checkbox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));

    const box = screen.getByRole('checkbox', { name: 'Renew automatically by card' });
    expect(box).not.toBeChecked();
    expect(screen.getByText('We’ll charge your card when this period ends. Turn it off any time.')).toBeInTheDocument();
    expect(box).toHaveAccessibleDescription('We’ll charge your card when this period ends. Turn it off any time.');
    expect(screen.getByText('FPX, e-wallet or card, through CHIP. It adds to the time you already have.')).toBeInTheDocument();
  });

  it('starts unticked every time the dialog opens: consent is for the payment in front of the owner', async () => {
    const { onPay } = pay();
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Renew automatically by card' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));
    expect(screen.getByRole('checkbox', { name: 'Renew automatically by card' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Continue to CHIP' }));
    expect(onPay).toHaveBeenCalledWith('MONTHLY', false);
  });

  it('says the card-only route when ticked', async () => {
    pay();
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('You’ll go to CHIP to pay by FPX, card or e-wallet, then come straight back here.');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Renew automatically by card' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('You’ll go to CHIP to pay by card, then come straight back here.');
  });

  it('names CHIP in the dialog and the busy state', async () => {
    pay({ onPay: vi.fn(() => new Promise<{ url: string }>(() => {})) });
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to CHIP' }));

    expect(screen.getByText('Opening CHIP…')).toBeInTheDocument();
    expect(screen.getByText('CHIP’s payment page opens next.')).toBeInTheDocument();
  });

  it('stops saying Opening CHIP when the page comes back from the back-forward cache', async () => {
    pay({ onPay: vi.fn(() => new Promise<{ url: string }>(() => {})) });
    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue to CHIP' }));
    expect(screen.getByText('Opening CHIP…')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    });
    expect(screen.queryByText('Opening CHIP…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue to CHIP' })).toBeInTheDocument();
  });

  it('opens from the shared dialog state, so Pay another way and Try again can open it', async () => {
    render(
      <PayDialogProvider>
        <Opener />
        <PlanPay options={options} onPay={vi.fn()} navigate={vi.fn()} />
      </PayDialogProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open from elsewhere' }));
    expect(screen.getByRole('dialog', { name: 'Add a month' })).toBeInTheDocument();
  });
});

function Opener() {
  const shared = usePayDialog();
  return (
    <button type="button" onClick={() => shared?.setOpen(true)}>
      Open from elsewhere
    </button>
  );
}

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
