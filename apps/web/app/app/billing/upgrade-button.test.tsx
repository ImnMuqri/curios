import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpgradeForm } from './upgrade-button.js';

describe('UpgradeForm', () => {
  it('asks before switching, and says it cannot be undone', async () => {
    const onUpgrade = vi.fn(async () => undefined);
    render(<UpgradeForm onUpgrade={onUpgrade} refresh={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Make this a business page' }));

    // One click must not do it: it is one-way, and it ends the privacy default.
    expect(onUpgrade).not.toHaveBeenCalled();
    expect(screen.getByText(/appear in search results/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /can't be undone/ })).toBeInTheDocument();
  });

  it('switches, then re-reads the screen', async () => {
    const onUpgrade = vi.fn(async () => undefined);
    const refresh = vi.fn();
    render(<UpgradeForm onUpgrade={onUpgrade} refresh={refresh} />);

    await userEvent.click(screen.getByRole('button', { name: 'Make this a business page' }));
    await userEvent.click(screen.getByRole('button', { name: /can't be undone/ }));

    expect(onUpgrade).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('lets the owner back out', async () => {
    const onUpgrade = vi.fn(async () => undefined);
    render(<UpgradeForm onUpgrade={onUpgrade} refresh={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Make this a business page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep it personal' }));

    expect(onUpgrade).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Make this a business page' })).toBeInTheDocument();
  });
});
