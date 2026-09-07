import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AskSheet } from './AskSheet.js';

function streamOf(...events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });
}

describe('AskSheet', () => {
  it('asks the seed question immediately, so opening it does something', async () => {
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(<AskSheet seed="Berapa harga kek?" onClose={vi.fn()} onAsk={onAsk} />);

    await waitFor(() => expect(onAsk).toHaveBeenCalledWith('Berapa harga kek?'));
  });

  it('renders streamed text as it arrives', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValue(
        streamOf('data: {"type":"text","text":"RM45 "}\n\n', 'data: {"type":"text","text":"sekilo."}\n\n'),
      );
    render(<AskSheet seed="harga?" onClose={vi.fn()} onAsk={onAsk} />);

    await waitFor(() => expect(screen.getByText(/RM45 sekilo\./)).toBeInTheDocument());
  });

  it('handles an event split across two chunks', async () => {
    // SSE events routinely straddle chunk boundaries. This was solved once in
    // the slice-1 ask bar and the fix travels with the code rather than being
    // rediscovered by whoever next sees half a JSON payload.
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"text","tex', 't":"split"}\n\n'));
    render(<AskSheet seed="q" onClose={vi.fn()} onAsk={onAsk} />);

    await waitFor(() => expect(screen.getByText(/split/)).toBeInTheDocument());
  });

  it('replaces a half answer with the error rather than appending to it', async () => {
    // A truncated answer followed by an apology reads worse than the apology.
    const onAsk = vi
      .fn()
      .mockResolvedValue(
        streamOf(
          'data: {"type":"text","text":"RM"}\n\n',
          'data: {"type":"error","message":"That answer failed. Try again."}\n\n',
        ),
      );
    render(<AskSheet seed="q" onClose={vi.fn()} onAsk={onAsk} />);

    await waitFor(() =>
      expect(screen.getByText('That answer failed. Try again.')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/^RM$/)).not.toBeInTheDocument();
  });

  it('says something useful when the request never lands', async () => {
    // Explains and instructs. The visitor never sees the raw error.
    const onAsk = vi.fn().mockRejectedValue(new Error('offline'));
    render(<AskSheet seed="q" onClose={vi.fn()} onAsk={onAsk} />);

    await waitFor(() => expect(screen.getByText(/try again/i)).toBeInTheDocument());
  });

  it('closes on escape', async () => {
    const onClose = vi.fn();
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(<AskSheet seed="q" onClose={onClose} onAsk={onAsk} />);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('is a modal dialog, so focus and the accessibility tree agree', async () => {
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(<AskSheet seed="q" onClose={vi.fn()} onAsk={onAsk} />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('announces the answer politely', async () => {
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"text","text":"RM45"}\n\n'));
    render(<AskSheet seed="q" onClose={vi.fn()} onAsk={onAsk} />);

    const live = await screen.findByRole('status');
    await waitFor(() => expect(live).toHaveTextContent('RM45'));
  });

  it('moves focus into the sheet so the keyboard follows the eye', async () => {
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(<AskSheet seed="q" onClose={vi.fn()} onAsk={onAsk} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /close/i })).toHaveFocus(),
    );
  });
});
