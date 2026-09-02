import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiError } from '../../lib/api.js';
import { VerifyClient } from './verify-client.js';

describe('VerifyClient', () => {
  it('confirms the address when the token is good', async () => {
    render(<VerifyClient token="good" verify={vi.fn().mockResolvedValue({})} />);

    expect(await screen.findByText(/your email is confirmed/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument();
  });

  it('explains an expired link and offers the way out', async () => {
    const verify = vi.fn().mockRejectedValue(
      new ApiError(400, 'INVALID_TOKEN', 'That link has expired or has already been used. Request a new one.'),
    );
    render(<VerifyClient token="stale" verify={verify} />);

    // A single-use token means the second click on the same link fails, and
    // people do click twice. Saying so, and saying what to do, is the whole
    // job of this screen.
    expect(await screen.findByText(/expired or has already been used/i)).toBeInTheDocument();
  });

  it('says something useful when the link carries no token at all', () => {
    render(<VerifyClient token={undefined} verify={vi.fn()} />);

    // Mail clients truncate long URLs. This is a real way to arrive here.
    expect(screen.getByText(/link looks incomplete/i)).toBeInTheDocument();
  });
});
