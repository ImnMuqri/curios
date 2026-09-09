import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CaptureCard } from './CaptureCard.js';

describe('CaptureCard', () => {
  it('names who receives the number, in plain sight', () => {
    // PDPA, and BACKEND.md is specific: the consent line names the page owner
    // as the recipient, and it is not hidden in a tooltip. Asserted on the
    // consent sentence itself rather than on the name anywhere -- the name
    // also appears in the invitation above, and matching that would pass while
    // the consent line said nothing.
    render(<CaptureCard shopName="Nadia Bakes" onSubmit={vi.fn()} />);
    expect(screen.getByText(/Your number goes to Nadia Bakes/)).toBeInTheDocument();
  });

  it('says who does not get the number either', () => {
    render(<CaptureCard shopName="Nadia Bakes" onSubmit={vi.fn()} />);
    expect(screen.getByText(/Nobody else sees it/)).toBeInTheDocument();
  });

  it('asks for one field and no more', () => {
    // BACKEND.md: "Capture takes one field, the phone." Slots come from the
    // transcript. A second field here is a form, and a form is a bounce.
    render(<CaptureCard shopName="Nadia Bakes" onSubmit={vi.fn()} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('does not submit an empty number', async () => {
    const onSubmit = vi.fn();
    render(<CaptureCard shopName="Nadia Bakes" onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows what the server said when the number is refused', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(
        new Error('That does not look like a Malaysian mobile number. Try 012-345 6789.'),
      );
    render(<CaptureCard shopName="Nadia Bakes" onSubmit={onSubmit} />);

    await userEvent.type(screen.getByRole('textbox'), '0323456789');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    // Verbatim: the API's message says what to do next, and rewriting it here
    // would replace instruction with apology.
    expect(await screen.findByRole('alert')).toHaveTextContent(/Malaysian mobile/);
  });

  it('confirms rather than leaving the form sitting there', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<CaptureCard shopName="Nadia Bakes" onSubmit={onSubmit} />);

    await userEvent.type(screen.getByRole('textbox'), '0123456789');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('status')).toBeInTheDocument();
    // A form still sitting there after a successful send invites a second
    // submission, which the server refuses -- so the visitor's reward for
    // succeeding would be an error.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('cannot be submitted twice while the first is in flight', async () => {
    const onSubmit = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<CaptureCard shopName="Nadia Bakes" onSubmit={onSubmit} />);

    await userEvent.type(screen.getByRole('textbox'), '0123456789');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });
});
