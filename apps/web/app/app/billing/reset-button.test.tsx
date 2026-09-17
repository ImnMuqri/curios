import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { ResetTrialForm, resetError } from './reset-button.js';

describe('ResetTrialForm', () => {
  it('resets, then re-reads the screen rather than guessing locally', async () => {
    const onReset = vi.fn(async () => undefined);
    const refresh = vi.fn();
    render(<ResetTrialForm onReset={onReset} refresh={refresh} />);

    await userEvent.click(screen.getByRole('button', { name: 'Reset my free trial' }));

    expect(onReset).toHaveBeenCalledTimes(1);
    // The count lives on the server. Refreshing is how the notice, the summary
    // and the button itself all agree about what just happened.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the API’s own sentence when the reset is already gone', async () => {
    const onReset = vi.fn(async () => {
      throw new ApiError(
        409,
        'TRIAL_RESET_USED',
        'The free trial can be reset once, and only for a page that has never paid. Pay for a month to keep capturing leads.',
      );
    });
    render(<ResetTrialForm onReset={onReset} refresh={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Reset my free trial' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('can be reset once');
  });

  it('does not refresh when the reset failed', async () => {
    const refresh = vi.fn();
    render(
      <ResetTrialForm
        onReset={vi.fn(async () => {
          throw new ApiError(409, 'TRIAL_RESET_USED', 'Already used.');
        })}
        refresh={refresh}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Reset my free trial' }));

    await screen.findByRole('alert');
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('resetError', () => {
  it('passes any other API message through unchanged', () => {
    expect(resetError(new ApiError(429, 'RATE_LIMITED', 'Too many payment attempts. Try again in 1 hour.'))).toBe(
      'Too many payment attempts. Try again in 1 hour.',
    );
  });
});
