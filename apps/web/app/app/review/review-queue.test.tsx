import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { ReviewQueue } from './review-queue.js';

// So router.refresh() is a spy. There is no `Review` under test here -- these
// tests render the presentational `ReviewQueue` with fake handlers, the same
// way claim-form.test.tsx renders `ClaimForm` rather than `Claim` -- but A2's
// "the local removal alone would be a lie about the server's state" only
// holds if the refresh call is a structural guarantee of the component that
// owns the `acted` set, not an accident of whichever closure happens to call
// it. See the report for why this places the router call in `ReviewQueue`
// rather than `Review`, departing from the plan's literal wording.
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

const facts = [
  {
    id: 'f-1',
    category: 'PRICE' as const,
    claim: 'Kuih lapis is RM12 a box',
    sourceText: 'Our kuih lapis is RM12 per box, minimum two boxes.',
    sourceUrl: 'https://nadia.example/menu',
    confidence: 0.91,
  },
  {
    id: 'f-2',
    category: 'HOURS' as const,
    claim: 'Open 9am to 6pm, Tuesday to Sunday',
    sourceText: 'We open 9-6, Tue-Sun.',
    sourceUrl: null,
    confidence: 0.8,
  },
];

describe('ReviewQueue', () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  it('removes an accepted card from the queue', async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    render(<ReviewQueue facts={facts} onAccept={onAccept} onEdit={vi.fn()} onReject={vi.fn()} />);

    await userEvent.click(screen.getAllByRole('button', { name: /^accept$/i })[0]!);

    // The local removal alone would be a lie about the server's state.
    expect(await screen.findByText(/open 9am to 6pm/i)).toBeInTheDocument();
    expect(screen.queryByText(/kuih lapis is rm12 a box/i)).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('removes a rejected card from the queue', async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(<ReviewQueue facts={facts} onAccept={vi.fn()} onEdit={vi.fn()} onReject={onReject} />);

    await userEvent.click(screen.getAllByRole('button', { name: /^reject$/i })[0]!);

    expect(await screen.findByText(/open 9am to 6pm/i)).toBeInTheDocument();
    expect(screen.queryByText(/kuih lapis is rm12 a box/i)).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps an edited card, showing the corrected claim -- an edit is not an acceptance', async () => {
    // Per A3: editFact leaves verified: false. If this ever starts passing
    // because edit removes the card, someone has "simplified" edit into
    // accept and reopened the side door the hard rule was built to close.
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(<ReviewQueue facts={facts} onAccept={vi.fn()} onEdit={onEdit} onReject={vi.fn()} />);

    await userEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]!);
    const field = screen.getByRole('textbox');
    await userEvent.clear(field);
    await userEvent.type(field, 'Kuih lapis is RM14 a box');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/kuih lapis is rm14 a box/i)).toBeInTheDocument();
    // Still in the queue, and the other card was never touched.
    expect(screen.getByText(/open 9am to 6pm/i)).toBeInTheDocument();
  });

  it('renders the API’s own sentence when an edit collides with an existing fact', async () => {
    // ApiError, not a plain { code, message } object -- the catch this
    // exercises checks `instanceof Error`, and a plain object silently takes
    // the generic branch. Cost six tests a fix round in Task 2.
    const onEdit = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'FACT_DUPLICATE', 'You already have a fact that says this.'));
    render(<ReviewQueue facts={facts} onAccept={vi.fn()} onEdit={onEdit} onReject={vi.fn()} />);

    await userEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]!);
    const field = screen.getByRole('textbox');
    await userEvent.clear(field);
    await userEvent.type(field, 'Kuih lapis is RM14 a box');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/you already have a fact that says this/i)).toBeInTheDocument();
    // The card is still there, showing the claim it had before the failed
    // edit -- not silently swapped to a claim the API never accepted.
    expect(screen.getByText(/kuih lapis is rm12 a box/i)).toBeInTheDocument();
  });

  it('tells the owner there is nothing left, as an instruction rather than a mood', () => {
    render(<ReviewQueue facts={[]} onAccept={vi.fn()} onEdit={vi.fn()} onReject={vi.fn()} />);

    expect(screen.getByText(/nothing left to review/i)).toBeInTheDocument();
  });
});
