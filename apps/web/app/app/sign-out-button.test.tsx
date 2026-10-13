import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api.js';
import { SignOutButton } from './sign-out-button.js';

describe('SignOutButton', () => {
  it('ends the session, then goes to sign in', async () => {
    const signOut = vi.fn(async () => undefined);
    const navigate = vi.fn();
    render(<SignOutButton signOut={signOut} navigate={navigate} />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/signin');
  });

  it('stays put and says so when the session could not be ended', async () => {
    const signOut = vi.fn(async () => {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Something failed on our side.');
    });
    const navigate = vi.fn();
    render(<SignOutButton signOut={signOut} navigate={navigate} />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't sign you out. Try again.");
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('cannot be pressed twice while signing out', async () => {
    let finish: () => void = () => undefined;
    const signOut = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<SignOutButton signOut={signOut} navigate={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled();
    finish();
  });
});
