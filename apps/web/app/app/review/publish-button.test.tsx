import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { PublishButton } from './publish-button.js';

describe('PublishButton', () => {
  it('publishes once and says so', async () => {
    const onPublish = vi.fn().mockResolvedValue(undefined);
    render(<PublishButton publicUrl="https://example.com/nadia" published={false} onPublish={onPublish} />);

    await userEvent.click(screen.getByRole('button', { name: /publish/i }));

    // Two lines rather than toHaveBeenCalledExactlyOnceWith -- see A1. Called
    // with no arguments: publish takes no payload, the account is derived
    // from the session on the API side.
    expect(onPublish).toHaveBeenCalledTimes(1);
    expect(onPublish).toHaveBeenCalledWith();
    expect(await screen.findByText(/live/i)).toBeInTheDocument();
  });

  it('shows the public URL as a link afterwards', async () => {
    const onPublish = vi.fn().mockResolvedValue(undefined);
    render(<PublishButton publicUrl="https://example.com/nadia" published={false} onPublish={onPublish} />);

    await userEvent.click(screen.getByRole('button', { name: /publish/i }));

    // A publish button that does not then tell you where the page is has
    // done half the job.
    const link = await screen.findByRole('link', { name: /example\.com\/nadia/i });
    expect(link).toHaveAttribute('href', 'https://example.com/nadia');
  });

  it("renders NO_PAGE's own sentence", async () => {
    // Reachable only if the page disappears between the server render and the
    // click -- a race, not a real path (B4). Kept anyway: it costs three
    // lines and it is the difference between showing the API's sentence and
    // showing nothing.
    const onPublish = vi.fn().mockRejectedValue(new ApiError(404, 'NO_PAGE', 'Claim a handle first.'));
    render(<PublishButton publicUrl="https://example.com/nadia" published={false} onPublish={onPublish} />);

    await userEvent.click(screen.getByRole('button', { name: /publish/i }));

    expect(await screen.findByText(/claim a handle first/i)).toBeInTheDocument();
  });

  it('is not disabled when nothing is verified', () => {
    // PublishButton takes no signal about facts or verification at all --
    // there is nothing here to gate on. That absence IS F5: publish must not
    // be disabled on review state, because neither the spec nor the API has
    // such a rule. Step 3 of the task proves this test actually fails the
    // day a gate is added.
    render(<PublishButton publicUrl="https://example.com/nadia" published={false} onPublish={vi.fn()} />);

    expect(screen.getByRole('button', { name: /publish/i })).not.toBeDisabled();
  });

  it('does not publish twice on a double tap', async () => {
    let release: () => void = () => {};
    const onPublish = vi.fn(() => new Promise<void>((r) => (release = r)));
    render(<PublishButton publicUrl="https://example.com/nadia" published={false} onPublish={onPublish} />);

    await userEvent.click(screen.getByRole('button', { name: /publish/i }));
    await userEvent.click(screen.getByRole('button', { name: /publishing/i }));

    // Two publishes would both succeed against the API -- publishing twice is
    // harmless server-side -- but a button that fires twice on one tap is
    // still a bug, and the pattern here matches every other form in the app.
    expect(onPublish).toHaveBeenCalledTimes(1);
    release();
    // Flushes the state updates `release()` triggers (setDone, setBusy)
    // inside an awaited act(), rather than letting React warn about an
    // update after the test's own act scope has already closed.
    await screen.findByText(/live/i);
  });

  it('shows the live URL and no button once published', () => {
    // B1: once published there is nothing left to do -- both public read
    // paths filter on verified: true at read time, so a fact accepted after
    // publishing appears immediately with no second publish. A permanently
    // enabled button, or a "Republish" label, would lie about that.
    render(<PublishButton publicUrl="https://example.com/nadia" published onPublish={vi.fn()} />);

    expect(screen.getByRole('link', { name: /example\.com\/nadia/i })).toHaveAttribute(
      'href',
      'https://example.com/nadia',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
