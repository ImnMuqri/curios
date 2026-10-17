import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api.js';
import { ResetForm } from './reset-form.js';

const form = (onReset = vi.fn().mockResolvedValue({})) => {
  render(<ResetForm token="t" email="lina@keklina.example" onReset={onReset} />);
  return onReset;
};

describe('ResetForm', () => {
  it('names the address and says this device stays signed in', () => {
    form();
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    expect(screen.getByText('For lina@keklina.example. You’ll stay signed in on this device.')).toBeInTheDocument();
  });

  it('rates the password as it is typed, in the board’s words', async () => {
    const onReset = form();
    const field = screen.getByLabelText('New password');
    expect(screen.getByText('8 characters or more.')).toBeInTheDocument();

    await userEvent.type(field, 'abc');
    expect(screen.getByText('Too short. 8 characters or more.')).toBeInTheDocument();
    // Under eight characters the button does nothing.
    await userEvent.click(screen.getByRole('button', { name: 'Change my password' }));
    expect(onReset).not.toHaveBeenCalled();

    await userEvent.type(field, 'defgh');
    expect(screen.getByText('Okay. A number makes it stronger.')).toBeInTheDocument();
    await userEvent.type(field, '1234');
    expect(screen.getByText('Strong.')).toBeInTheDocument();
  });

  it('shows and hides the password', async () => {
    form();
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password');
  });

  it('surfaces a weak password with the API reason', async () => {
    form(vi.fn().mockRejectedValue(new ApiError(400, 'WEAK_PASSWORD', 'That password has appeared in a public breach. Pick another.')));

    await userEvent.type(screen.getByLabelText('New password'), 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Change my password' }));

    // The API screens against Have I Been Pwned. Telling someone their
    // password is "invalid" when the real reason is that it is in a breach
    // list wastes their next three guesses.
    expect(await screen.findByRole('alert')).toHaveTextContent(/public breach/);
  });

  it('turns a link that went bad meanwhile into the broken-link screen', async () => {
    form(vi.fn().mockRejectedValue(new ApiError(400, 'INVALID_TOKEN', 'That link has expired or has already been used.')));

    await userEvent.type(screen.getByLabelText('New password'), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change my password' }));

    expect(await screen.findByRole('heading', { name: 'That link doesn’t work' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send me a new link' })).toHaveAttribute('href', '/forgot');
  });

  it('confirms, and goes straight to the page', async () => {
    const onReset = form();

    await userEvent.type(screen.getByLabelText('New password'), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Change my password' }));

    expect(onReset).toHaveBeenCalledWith({ token: 't', password: 'a-long-enough-passphrase' });
    expect(await screen.findByRole('heading', { name: 'Password changed' })).toBeInTheDocument();
    expect(screen.getByText('You can sign in with it now, on any device.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to my page' })).toHaveAttribute('href', '/app');
  });
});
