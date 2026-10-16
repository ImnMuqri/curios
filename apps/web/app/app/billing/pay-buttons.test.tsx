import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { PayButtonsForm, payError } from './pay-buttons.js';

const options = [
  { plan: 'MONTHLY' as const, label: 'Pay RM49 for a month' },
  { plan: 'ANNUAL' as const, label: 'Pay RM490 for a year' },
];

describe('PayButtonsForm', () => {
  it('raises a bill for the plan pressed, and sends the browser to it', async () => {
    const onPay = vi.fn(async () => ({ url: 'https://www.billplz-sandbox.com/bills/abc' }));
    const navigate = vi.fn();
    render(<PayButtonsForm options={options} onPay={onPay} navigate={navigate} />);

    await userEvent.click(screen.getByRole('button', { name: 'Pay RM490 for a year' }));

    expect(onPay).toHaveBeenCalledWith('ANNUAL');
    expect(navigate).toHaveBeenCalledWith('https://www.billplz-sandbox.com/bills/abc');
  });

  it('holds the other button while one payment is starting', async () => {
    let finish = () => {};
    const onPay = vi.fn(
      () =>
        new Promise<{ url: string }>((resolve) => {
          finish = () => resolve({ url: 'https://www.billplz-sandbox.com/bills/abc' });
        }),
    );
    render(<PayButtonsForm options={options} onPay={onPay} navigate={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49 for a month' }));

    // Two bills raised by a double press would leave two pending payments for one owner.
    expect(screen.getByRole('button', { name: 'Pay RM490 for a year' })).toBeDisabled();
    finish();
  });

  it('says Billplz is not answering when the API reports it by code', async () => {
    // The API replaces a 502's message with its generic sentence, so the code is all that
    // arrives. This screen supplies the words.
    const onPay = vi.fn(async (): Promise<{ url: string }> => {
      throw new ApiError(502, 'BILLPLZ_UNAVAILABLE', 'Something failed on our side. Try again.');
    });
    render(<PayButtonsForm options={options} onPay={onPay} navigate={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Pay RM49 for a month' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Billplz is not answering right now. Try again in a few minutes.',
    );
  });
});

describe('payError', () => {
  // Development without Billplz settings. A 503, so again only the code arrives.
  it('says payments are switched off when billing is not configured', () => {
    const failure = new ApiError(503, 'BILLING_NOT_CONFIGURED', 'Something failed on our side. Try again.');

    expect(payError(failure)).toBe(
      'Payments are switched off here: no Billplz settings in this environment.',
    );
  });

  it('passes any other API message through unchanged', () => {
    expect(payError(new ApiError(429, 'RATE_LIMITED', 'Too many payment attempts. Try again in 1 hour.'))).toBe(
      'Too many payment attempts. Try again in 1 hour.',
    );
  });
});
