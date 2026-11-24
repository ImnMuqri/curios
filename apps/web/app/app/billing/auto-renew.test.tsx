import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { AutoRenewCard } from './auto-renew.js';

const card = { label: 'Visa ending 4242', price: 'RM49', paidUntil: '14 Dec 2026', failed: false, ended: false };

function view(overrides: Partial<Parameters<typeof AutoRenewCard>[0]> = {}) {
  const props = { card, canPay: true, onPayAnother: vi.fn(), onOff: vi.fn(async () => undefined), refresh: vi.fn(), ...overrides };
  const utils = render(<AutoRenewCard {...props} />);
  return { ...props, ...utils };
}

describe('AutoRenewCard', () => {
  it('shows auto-renew, asks before turning it off, then says it is off', async () => {
    const { onOff, refresh } = view();
    expect(screen.getByText('Auto-renew is on')).toBeInTheDocument();
    expect(screen.getByText('We’ll charge Visa ending 4242 RM49 on 14 Dec 2026.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    // Asked first: nothing is sent until the owner confirms.
    expect(onOff).not.toHaveBeenCalled();
    expect(screen.getByText('Turn off auto-renew? Your plan still runs until 14 Dec 2026, then stops unless you pay again.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off auto-renew' }));

    expect(onOff).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The card stays to say so, even once the page stops sending one.
    expect(await screen.findByText('Auto-renew is off')).toBeInTheDocument();
    expect(screen.getByText('Your plan runs until 14 Dec 2026. Pay again any time from here.')).toBeInTheDocument();
  });

  it('keeps saying it is off after the page sends no card', async () => {
    const { rerender, onOff, refresh } = view();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn off auto-renew' }));
    rerender(<AutoRenewCard card={null} canPay onPayAnother={vi.fn()} onOff={onOff} refresh={refresh} />);
    expect(screen.getByText('Auto-renew is off')).toBeInTheDocument();
  });

  it('draws nothing when there is no card and nothing was turned off', () => {
    const { container } = view({ card: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('says your card when the label is unknown', () => {
    view({ card: { ...card, label: null } });
    expect(screen.getByText('We’ll charge your card RM49 on 14 Dec 2026.')).toBeInTheDocument();
  });

  it('says the last renewal failed, that the plan still runs, and offers to pay another way', async () => {
    const { onPayAnother } = view({ card: { ...card, failed: true } });
    expect(screen.getByText('Your last renewal didn’t go through')).toBeInTheDocument();
    expect(screen.getByText('We’ll try Visa ending 4242 again tomorrow. Your plan still runs until 14 Dec 2026.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn off auto-renew' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Pay another way' }));
    expect(onPayAnother).toHaveBeenCalledTimes(1);
  });

  it('has no Pay another way while online payments are paused', () => {
    view({ card: { ...card, failed: true }, canPay: false });
    expect(screen.queryByRole('button', { name: 'Pay another way' })).toBeNull();
  });

  it('says when an ended plan is tried again, and still turns it off', async () => {
    // The job keeps charging up to 3 days after the plan ends: the owner can stop tomorrow's charge.
    const { onOff } = view({ card: { ...card, paidUntil: '12 Oct 2026', ended: true, failed: true } });
    expect(screen.getByText('Your plan ended on 12 Oct 2026. We’ll try Visa ending 4242 again tomorrow.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Turn off auto-renew' }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn off auto-renew' }));
    expect(onOff).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Your plan ended on 12 Oct 2026. Pay again any time from here.')).toBeInTheDocument();
  });

  it('says your card for an ended plan when the label is unknown', () => {
    view({ card: { ...card, label: null, paidUntil: '12 Oct 2026', ended: true } });
    expect(screen.getByText('Your plan ended on 12 Oct 2026. We’ll try your card again tomorrow.')).toBeInTheDocument();
  });

  it('keeps it on when the owner backs out', async () => {
    const { onOff } = view();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep it on' }));

    expect(onOff).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
  });

  it('shows the failure and does not refresh when turning it off fails', async () => {
    const { refresh } = view({
      onOff: vi.fn(async () => {
        throw new ApiError(500, 'INTERNAL', 'Something failed on our side. Try again.');
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn off auto-renew' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something failed on our side. Try again.');
    expect(refresh).not.toHaveBeenCalled();
  });
});
