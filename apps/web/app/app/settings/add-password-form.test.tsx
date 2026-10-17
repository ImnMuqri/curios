import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { AddPasswordForm, strength } from './add-password-form.js';

/** The field opens from the row's own "Add password". */
async function open() {
  await userEvent.click(screen.getByRole('button', { name: 'Add password' }));
}

describe('AddPasswordForm', () => {
  it('adds a password and confirms it', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddPasswordForm onAdd={onAdd} />);
    await open();

    await userEvent.type(screen.getByLabelText(/new password/i), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /add password/i }));

    // Two lines rather than toHaveBeenCalledExactlyOnceWith -- this repo's
    // vitest (2.1.9) does not have it.
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({ password: 'a-long-enough-passphrase' });
    expect(await screen.findByText(/password added/i)).toBeInTheDocument();
    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).toBeNull();
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
    await open();

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
    await open();

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
    await open();

    await userEvent.type(screen.getByLabelText(/new password/i), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /add password/i }));
    await userEvent.click(screen.getByRole('button', { name: /adding/i }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    release();
    await screen.findByText(/password added/i);
  });

  it('opens from its row, and Cancel closes it with nothing sent', async () => {
    const onAdd = vi.fn();
    render(<AddPasswordForm onAdd={onAdd} />);
    expect(screen.queryByLabelText(/new password/i)).toBeNull();

    await open();
    expect(screen.getByLabelText(/new password/i)).toHaveFocus();
    await userEvent.type(screen.getByLabelText(/new password/i), 'half-typed');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText(/new password/i)).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('strength', () => {
  it('is only a hint: nothing, short, one kind of character, fair, long', () => {
    expect(strength('')).toBe(0);
    expect(strength('abc1')).toBe(1);
    expect(strength('abcdefgh')).toBe(2);
    expect(strength('abcdefg1')).toBe(3);
    expect(strength('a-long-passphrase-1')).toBe(4);
  });
});
