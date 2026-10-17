import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api.js';
import { ForgotForm } from './forgot-form.js';

describe('ForgotForm', () => {
  it('holds an address that is not one yet', async () => {
    const onSubmit = vi.fn().mockResolvedValue({});
    render(<ForgotForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText('Email'), 'lina@');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sends, then says the same thing whether or not the address has an account', async () => {
    const onSubmit = vi.fn().mockResolvedValue({});
    render(<ForgotForm onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText('Email'), 'lina@keklina.example');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(onSubmit).toHaveBeenCalledWith({ email: 'lina@keklina.example' });
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText(/has a Curios account, a link to choose a new password is on its way\. It works for one hour\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/signin');
    // Another email has to wait.
    expect(screen.getByRole('button', { name: /send again in 0:4/ })).toBeDisabled();
  });

  it('says why when the send is refused', async () => {
    render(<ForgotForm onSubmit={vi.fn().mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Too many tries. Wait a minute.'))} />);

    await userEvent.type(screen.getByLabelText('Email'), 'lina@keklina.example');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries. Wait a minute.');
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();
  });
});
