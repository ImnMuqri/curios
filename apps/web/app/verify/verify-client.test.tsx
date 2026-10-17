import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api.js';
import { ExpiredLink, Verified, VerifyClient } from './verify-client.js';

const who = { email: 'lina@keklina.example', name: 'Lina Aziz' };

describe('VerifyClient', () => {
  it('says it is confirming, then confirms, by first name, with where email will go', async () => {
    let finish: (value: unknown) => void = () => {};
    const verify = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    render(<VerifyClient token="good" {...who} verify={verify} />);

    expect(screen.getByRole('status')).toHaveTextContent('Confirming your address…');
    finish({});

    expect(await screen.findByRole('heading', { name: 'Your email is confirmed' })).toBeInTheDocument();
    expect(screen.getByText('Thanks, Lina. Receipts, new orders and leads will come to lina@keklina.example.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up my page' })).toHaveAttribute('href', '/app/onboarding');
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('turns a link spent meanwhile into the broken-link screen', async () => {
    const verify = vi.fn().mockRejectedValue(new ApiError(400, 'INVALID_TOKEN', 'That link has expired or has already been used.'));
    render(<VerifyClient token="stale" {...who} verify={verify} />);

    expect(await screen.findByRole('heading', { name: 'That link doesn’t work' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says why when something else fails', async () => {
    const verify = vi.fn().mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'Too many tries. Wait a minute.'));
    render(<VerifyClient token="t" {...who} verify={verify} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries. Wait a minute.');
  });
});

describe('Verified', () => {
  it('thanks nobody by name when there is no name', () => {
    render(<Verified email="lina@keklina.example" name={null} />);
    expect(screen.getByText('Thanks. Receipts, new orders and leads will come to lina@keklina.example.')).toBeInTheDocument();
  });
});

describe('ExpiredLink', () => {
  it('sends a fresh link, then waits before another', async () => {
    const resend = vi.fn().mockResolvedValue({});
    render(<ExpiredLink token="old" email="lina@keklina.example" resend={resend} />);

    expect(screen.getByText('Confirmation links last 24 hours. We can send a fresh one to lina@keklina.example.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send a new link' }));

    expect(resend).toHaveBeenCalledWith('old');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sent. Check your inbox' })).toBeDisabled());
    expect(screen.getByRole('link', { name: 'I’ll do it later' })).toBeInTheDocument();
  });
});
