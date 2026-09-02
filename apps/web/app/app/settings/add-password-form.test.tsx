import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { AddPasswordForm } from './add-password-form.js';

describe('AddPasswordForm', () => {
  it('adds a password and confirms it', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddPasswordForm onAdd={onAdd} />);

    await userEvent.type(screen.getByLabelText(/new password/i), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /add password/i }));

    // Two lines rather than toHaveBeenCalledExactlyOnceWith -- this repo's
    // vitest (2.1.9) does not have it.
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({ password: 'a-long-enough-passphrase' });
    expect(await screen.findByText(/password added/i)).toBeInTheDocument();
  });

  it('explains PASSWORD_ALREADY_SET rather than letting someone guess why the form refused them', async () => {
    const onAdd = vi.fn().mockRejectedValue(
      new ApiError(
        409,
        'PASSWORD_ALREADY_SET',
        'This account already has a password. Use the reset link to change it.',
      ),
    );
    render(<AddPasswordForm onAdd={onAdd} />);

    await userEvent.type(screen.getByLabelText(/new password/i), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /add password/i }));

    // This form only ever appears when getSignInMethods says there is no
    // password yet, so this is a race -- a second tab, a second click -- and
    // the API's message is the one that says where to go instead: the reset
    // flow, not this form.
    expect(await screen.findByText(/use the reset link to change it/i)).toBeInTheDocument();
  });

  it('renders WEAK_PASSWORD verbatim, breach-list reason included', async () => {
    const onAdd = vi.fn().mockRejectedValue(
      new ApiError(400, 'WEAK_PASSWORD', 'That password has appeared in a public breach. Pick another.'),
    );
    render(<AddPasswordForm onAdd={onAdd} />);

    await userEvent.type(screen.getByLabelText(/new password/i), 'password');
    await userEvent.click(screen.getByRole('button', { name: /add password/i }));

    // The API screens against Have I Been Pwned. "Invalid password" would
    // waste the next three guesses.
    expect(await screen.findByText(/public breach/i)).toBeInTheDocument();
  });

  it('does not submit twice on a double tap', async () => {
    let release: () => void = () => {};
    const onAdd = vi.fn(() => new Promise<void>((r) => (release = r)));
    render(<AddPasswordForm onAdd={onAdd} />);

    await userEvent.type(screen.getByLabelText(/new password/i), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /add password/i }));
    await userEvent.click(screen.getByRole('button', { name: /adding/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    release();
    await screen.findByText(/password added/i);
  });
});
