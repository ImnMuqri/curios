import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../lib/api.js';
import { ResetForm } from './reset-form.js';

describe('ResetForm', () => {
  it('surfaces a weak password with the API reason', async () => {
    const reset = vi.fn().mockRejectedValue(
      new ApiError(400, 'WEAK_PASSWORD', 'That password has appeared in a public breach. Pick another.'),
    );
    render(<ResetForm token="t" onReset={reset} />);

    await userEvent.type(screen.getByLabelText(/new password/i), 'password');
    await userEvent.click(screen.getByRole('button', { name: /change my password/i }));

    // The API screens against Have I Been Pwned. Telling someone their
    // password is "invalid" when the real reason is that it is in a breach
    // list wastes their next three guesses.
    expect(await screen.findByText(/public breach/i)).toBeInTheDocument();
  });

  it('confirms, and says every other session was signed out', async () => {
    render(<ResetForm token="t" onReset={vi.fn().mockResolvedValue({})} />);

    await userEvent.type(screen.getByLabelText(/new password/i), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: /change my password/i }));

    // A completed reset deletes every session for the account. Someone
    // resetting because they think they were compromised needs to be told
    // that worked, not left guessing.
    expect(await screen.findByText(/signed out everywhere/i)).toBeInTheDocument();
  });
});
