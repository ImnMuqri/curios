import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { AutoRenewCard } from './auto-renew.js';

const card = { label: 'Visa ending 4242', price: 'RM49', paidUntil: '14 Dec 2026', failed: false, ended: false };

function view(overrides: Partial<Parameters<typeof AutoRenewCard>[0]> = {}) {
  const props = { card, onOff: vi.fn(async () => undefined), refresh: vi.fn(), ...overrides };
  render(<AutoRenewCard {...props} />);
  return props;
}

describe('AutoRenewCard', () => {
  it('shows auto-renew and turns it off', async () => {
    const { onOff, refresh } = view();
    expect(screen.getByText('Auto-renew is on. We’ll charge Visa ending 4242 RM49 on 14 Dec 2026.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Turn off auto-renew' }));
    // Asked first: nothing is sent until the owner confirms.
    expect(onOff).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));

    expect(onOff).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('says your card when the label is unknown', () => {
    view({ card: { ...card, label: null } });
    expect(screen.getByText('Auto-renew is on. We’ll charge your card RM49 on 14 Dec 2026.')).toBeInTheDocument();
  });

  it('says the last renewal failed', () => {
    view({ card: { ...card, failed: true } });
    expect(screen.getByText('Your last renewal didn’t go through. We’ll try again tomorrow.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn off auto-renew' })).toBeInTheDocument();
  });

  it('says when an ended plan is tried again, and still turns it off', async () => {
    // The job keeps charging up to 3 days after the plan ends: the owner can stop tomorrow's charge.
    const { onOff } = view({ card: { ...card, paidUntil: '12 Oct 2026', ended: true, failed: true } });
    expect(screen.getByText('Your plan ended on 12 Oct 2026. We’ll try Visa ending 4242 again tomorrow.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Turn off auto-renew' }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(onOff).toHaveBeenCalledTimes(1);
  });

  it('says your card for an ended plan when the label is unknown', () => {
    view({ card: { ...card, label: null, paidUntil: '12 Oct 2026', ended: true } });
    expect(screen.getByText('Your plan ended on 12 Oct 2026. We’ll try your card again tomorrow.')).toBeInTheDocument();
  });

  it('keeps it on when the owner backs out', async () => {
    const { onOff } = view();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off auto-renew' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep it on' }));

    expect(onOff).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Turn off auto-renew' })).toBeInTheDocument();
  });

  it('shows the failure and does not refresh when turning it off fails', async () => {
    const { refresh } = view({
      onOff: vi.fn(async () => {
        throw new ApiError(500, 'INTERNAL', 'Something failed on our side. Try again.');
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Turn off auto-renew' }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something failed on our side. Try again.');
    expect(refresh).not.toHaveBeenCalled();
  });
});
