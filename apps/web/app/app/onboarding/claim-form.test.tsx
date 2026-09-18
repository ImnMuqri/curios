import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { ClaimForm } from './claim-form.js';

const fill = async (handle: string, name = 'Nadia Bakes') => {
  await userEvent.type(screen.getByLabelText(/handle/i), handle);
  await userEvent.type(screen.getByLabelText(/display name/i), name);
  await userEvent.click(screen.getByRole('radio', { name: /^business/i }));
  await userEvent.click(screen.getByRole('button', { name: /claim/i }));
};

describe('ClaimForm', () => {
  it('tells "taken" apart from "too close to one already in use"', async () => {
    const claim = vi.fn().mockRejectedValue(
      new ApiError(409, 'HANDLE_TOO_SIMILAR', 'That handle is too close to one already in use. Pick another.'),
    );
    render(<ClaimForm monthlyPrice="RM39" onClaim={claim} />);

    await fill('nadiabakes');

    // Two different 409s. Someone told "taken" will try nadia-bakes, which
    // collides on the same skeleton and fails the same way. The API went to
    // the trouble of distinguishing them; the screen must not flatten it.
    expect(await screen.findByText(/too close to one already in use/i)).toBeInTheDocument();
  });

  it('explains a reserved handle without blaming the person', async () => {
    const claim = vi.fn().mockRejectedValue(
      new ApiError(400, 'HANDLE_RESERVED', 'That handle is reserved. Pick another.'),
    );
    render(<ClaimForm monthlyPrice="RM39" onClaim={claim} />);

    await fill('admin');

    expect(await screen.findByText(/reserved/i)).toBeInTheDocument();
  });

  it('shows the rule when the format is wrong, not just that it is wrong', async () => {
    const claim = vi.fn().mockRejectedValue(
      new ApiError(400, 'HANDLE_INVALID', 'Handles are 3 to 30 characters, letters, numbers, hyphens and underscores, and cannot start or end with a separator.'),
    );
    render(<ClaimForm monthlyPrice="RM39" onClaim={claim} />);

    await fill('ab');

    // The API's message states the whole rule. Replacing it with "invalid
    // handle" makes someone guess at what they broke.
    expect(await screen.findByText(/3 to 30 characters/i)).toBeInTheDocument();
  });

  it('does not submit twice on a double tap', async () => {
    let release: () => void = () => {};
    const claim = vi.fn(() => new Promise<void>((r) => (release = r)));
    render(<ClaimForm monthlyPrice="RM39" onClaim={claim} />);

    await fill('nadiabakes');
    await userEvent.click(screen.getByRole('button', { name: /claiming/i }));

    // Two claims race on the unique index and the loser is told the handle is
    // taken -- by themselves, a second ago.
    expect(claim).toHaveBeenCalledTimes(1);
    release();
  });

  it('offers no tier until the owner picks one', () => {
    // No default, on purpose: nobody should land in a tier they did not pick
    // and find out later.
    render(<ClaimForm monthlyPrice="RM39" onClaim={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /^personal/i })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /^business/i })).not.toBeChecked();
  });

  it('will not claim until a tier is chosen', async () => {
    const claim = vi.fn(async () => ({}));
    render(<ClaimForm monthlyPrice="RM39" onClaim={claim} />);

    await userEvent.type(screen.getByLabelText('Handle'), 'nadia');
    await userEvent.type(screen.getByLabelText('Display name'), 'Nadia');
    await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

    expect(claim).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Choose whether this page is about you or for selling.',
    );
  });

  it('sends the tier the owner chose', async () => {
    const claim = vi.fn(async () => ({}));
    render(<ClaimForm monthlyPrice="RM39" onClaim={claim} />);

    await userEvent.click(screen.getByRole('radio', { name: /^personal/i }));
    await userEvent.type(screen.getByLabelText('Handle'), 'nadia');
    await userEvent.type(screen.getByLabelText('Display name'), 'Nadia');
    await userEvent.click(screen.getByRole('button', { name: 'Claim' }));

    expect(claim).toHaveBeenCalledWith({ handle: 'nadia', displayName: 'Nadia', mode: 'PERSONAL' });
  });

  it('names the business price it was given', () => {
    render(<ClaimForm monthlyPrice="RM39" onClaim={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /RM39 a month/ })).toBeInTheDocument();
  });
});
