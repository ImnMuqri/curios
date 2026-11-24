import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { PaymentNotice } from './billing-copy.js';

const replace = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }), useSearchParams: () => new URLSearchParams() }));

const { PaymentToast, POLL_MS, POLL_TRIES, PAID_MS, SETTLE_MS } = await import('./payment-toast.js');
const { PayDialogProvider, usePayDialog } = await import('./pay-context.js');

const paid: PaymentNotice = { kind: 'paid', title: 'Paid RM49', sub: 'Business runs until 2 Jan 2027', note: null };
const failed: PaymentNotice = { kind: 'failed', title: 'Payment didn’t go through', short: 'Didn’t go through', sub: 'Nothing was charged' };
const checking: PaymentNotice = { kind: 'checking', title: 'Checking your payment…', sub: 'This takes a moment.' };

function PayState() {
  const shared = usePayDialog();
  return <p data-testid="open">{shared?.open ? 'open' : 'closed'}</p>;
}

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** The region is in the page first and its words come a tick later, so the first toast is announced. */
const settle = () => advance(SETTLE_MS + 5);

function view(notice: PaymentNotice | null, canPay = true) {
  const tree = (n: PaymentNotice | null) => (
    <PayDialogProvider>
      <PaymentToast notice={n} canPay={canPay} />
      <PayState />
      <section id="payments" />
    </PayDialogProvider>
  );
  const utils = render(tree(notice));
  return {
    ...utils,
    again: (n: PaymentNotice | null) => {
      utils.rerender(tree(n));
      settle();
    },
  };
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  replace.mockClear();
  refresh.mockClear();
  scrollIntoView.mockClear();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PaymentToast', () => {
  it('has its live region in the page before it has any words, then says Paid with the receipt link', () => {
    view(paid);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();

    settle();
    expect(screen.getByText('Paid RM49')).toBeInTheDocument();
    expect(screen.getByText('Business runs until 2 Jan 2027')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See receipt' })).toHaveAttribute('href', '#payments');
  });

  it('takes the payment off the address once it has shown, so a refresh does not play it again', () => {
    view(paid);
    settle();

    expect(replace).toHaveBeenCalledWith('/app/billing', { scroll: false });
  });

  it('keeps the toast on screen after the address is cleaned (the server then sends no notice)', () => {
    const { again } = view(paid);
    settle();
    again(null);

    expect(screen.getByText('Paid RM49')).toBeInTheDocument();
  });

  it('scrolls to the payments and goes away on See receipt', () => {
    view(paid);
    settle();
    fireEvent.click(screen.getByRole('link', { name: 'See receipt' }));

    expect(scrollIntoView).toHaveBeenCalled();
    expect(screen.queryByText('Paid RM49')).toBeNull();
  });

  it('can be dismissed', () => {
    view(paid);
    settle();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText('Paid RM49')).toBeNull();
  });

  it('goes by itself after a few seconds when paid', () => {
    view(paid);
    settle();
    advance(PAID_MS + 10);

    expect(screen.queryByText('Paid RM49')).toBeNull();
  });

  it('says it did not go through, that nothing was charged, and opens the pay dialog on Try again', () => {
    view(failed);
    settle();

    expect(screen.getByText('Nothing was charged')).toBeInTheDocument();
    expect(screen.getByText('Payment didn’t go through')).toBeInTheDocument();
    expect(screen.getByTestId('open')).toHaveTextContent('closed');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByTestId('open')).toHaveTextContent('open');
    expect(screen.queryByText('Nothing was charged')).toBeNull();
  });

  it('offers no Try again while online payments are off: there is no dialog to open', () => {
    view(failed, false);
    settle();

    expect(screen.getByText('Nothing was charged')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('does not go by itself when it failed: its button is worth reaching', () => {
    view(failed);
    settle();
    advance(PAID_MS * 3);

    expect(screen.getByText('Nothing was charged')).toBeInTheDocument();
  });

  it('says it is checking, not Paid, and asks the server again until it is decided', () => {
    const { again } = view(checking);
    settle();

    expect(screen.getByText('Checking your payment…')).toBeInTheDocument();
    expect(screen.queryByText(/^Paid/)).toBeNull();
    // Still on the address: that is what the server reads to look the payment up.
    expect(replace).not.toHaveBeenCalled();
    advance(POLL_MS * 2 + 10);
    expect(refresh).toHaveBeenCalledTimes(2);

    // The webhook landed: the same toast turns into Paid, and only then is the address cleaned.
    again(paid);
    expect(screen.getByText('Paid RM49')).toBeInTheDocument();
    expect(screen.queryByText('Checking your payment…')).toBeNull();
    expect(replace).toHaveBeenCalledWith('/app/billing', { scroll: false });
    advance(POLL_MS * 5);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('turns into Didn’t go through when the check comes back failed', () => {
    const { again } = view(checking);
    settle();
    again(failed);

    expect(screen.getByText('Nothing was charged')).toBeInTheDocument();
  });

  it('stops asking after a minute or so, says where it will show, and stops spinning', () => {
    const { container } = view(checking);
    settle();
    expect(container.ownerDocument.querySelector('[class*="spin"]')).not.toBeNull();
    advance(POLL_MS * (POLL_TRIES + 2));

    expect(refresh).toHaveBeenCalledTimes(POLL_TRIES);
    expect(screen.getByText('Still checking your payment')).toBeInTheDocument();
    expect(screen.getByText('It will show under Payments once CHIP confirms.')).toBeInTheDocument();
    expect(container.ownerDocument.querySelector('[class*="spin"]')).toBeNull();
    expect(replace).toHaveBeenCalledWith('/app/billing', { scroll: false });
  });

  it('adds the card-not-kept line to a paid toast', () => {
    view({ ...paid, note: 'Your plan is paid, but auto-renew couldn’t be turned on for this payment.' });
    settle();

    expect(screen.getByText(/auto-renew couldn’t be turned on/)).toBeInTheDocument();
  });

  it('draws nothing but the empty live region when there is no payment to report', () => {
    view(null);
    settle();

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
