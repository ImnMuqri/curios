import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
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

    await waitFor(() => expect(onAsk).toHaveBeenCalledWith('Berapa harga kek?', null));
  });

  // React mounts every component twice in development, on purpose. Asked from
  // an effect with no guard, the seed went out twice: two model calls, two
  // conversations against the page's cap, and both answers streamed into one
  // bubble word by word -- two greetings interleaved into nonsense.
  it('asks the seed question once, even when React mounts it twice', async () => {
    const onAsk = vi.fn().mockResolvedValue(
      streamOf('data: {"type":"text","text":"Hai! "}\n\n', 'data: {"type":"done"}\n\n'),
    );
    render(
      <StrictMode>
        <AskSheet seed="Hello" onClose={vi.fn()} onAsk={onAsk} />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByText('Hai!')).toBeInTheDocument());
    expect(onAsk).toHaveBeenCalledTimes(1);
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

  it('sends no conversation id on the first question and the returned one after', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValueOnce(
        streamOf(
          'data: {"type":"text","text":"RM45"}\n\n',
          'data: {"type":"done","conversationId":"c1"}\n\n',
        ),
      )
      .mockResolvedValueOnce(streamOf('data: {"type":"done","conversationId":"c1"}\n\n'));

    render(<AskSheet seed="harga?" onClose={vi.fn()} onAsk={onAsk} />);
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith('harga?', null));

    await userEvent.type(screen.getByLabelText(/ask/i), 'ada delivery?');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(onAsk).toHaveBeenLastCalledWith('ada delivery?', 'c1'));
  });

  it('keeps every turn on screen, because the thread is the point', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValueOnce(
        streamOf(
          'data: {"type":"text","text":"RM45 sekilo"}\n\n',
          'data: {"type":"done","conversationId":"c1"}\n\n',
        ),
      )
      .mockResolvedValueOnce(
        streamOf(
          'data: {"type":"text","text":"Ya, boleh"}\n\n',
          'data: {"type":"done","conversationId":"c1"}\n\n',
        ),
      );

    render(<AskSheet seed="harga?" onClose={vi.fn()} onAsk={onAsk} />);
    await waitFor(() => expect(screen.getByText(/RM45 sekilo/)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/ask/i), 'ada delivery?');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    // The first answer is still on screen. A sheet that replaces it has no
    // transcript to send an owner, which is the whole reason for this plan.
    await waitFor(() => expect(screen.getByText(/Ya, boleh/)).toBeInTheDocument());
    expect(screen.getByText(/RM45 sekilo/)).toBeInTheDocument();
    expect(screen.getByText('harga?')).toBeInTheDocument();
    expect(screen.getByText('ada delivery?')).toBeInTheDocument();
  });

  it('will not send an empty question', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValue(streamOf('data: {"type":"done","conversationId":"c1"}\n\n'));
    render(<AskSheet seed="q" onClose={vi.fn()} onAsk={onAsk} />);
    await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it('does not send while an answer is still streaming', async () => {
    // Two overlapping streams would interleave their text into one bubble.
    const onAsk = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<AskSheet seed="q" onClose={vi.fn()} onAsk={onAsk} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeDisabled());
  });

  it('starts a fresh thread when the conversation has expired', async () => {
    // CONVERSATION_NOT_FOUND is the one error the client acts on rather than
    // only displaying: the stored id is dead, so the next question must not
    // carry it or every later turn fails for the same reason.
    const onAsk = vi
      .fn()
      .mockResolvedValueOnce(streamOf('data: {"type":"done","conversationId":"c1"}\n\n'))
      .mockResolvedValueOnce(
        streamOf(
          'data: {"type":"error","code":"CONVERSATION_NOT_FOUND","message":"That answer failed. Try again."}\n\n',
        ),
      )
      .mockResolvedValueOnce(streamOf('data: {"type":"done","conversationId":"c2"}\n\n'));

    render(<AskSheet seed="q" onClose={vi.fn()} onAsk={onAsk} />);
    await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByLabelText(/ask/i), 'two');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(2));

    await userEvent.type(screen.getByLabelText(/ask/i), 'three');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(onAsk).toHaveBeenLastCalledWith('three', null));
  });

  it('offers the card only when the server says the conversation qualified', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValue(
        streamOf('data: {"type":"done","conversationId":"c1","intent":{"qualified":false}}\n\n'),
      );
    render(
      <AskSheet
        seed="q"
        shopName="Nadia Bakes"
        onClose={vi.fn()}
        onAsk={onAsk}
        onCapture={vi.fn()}
      />,
    );

    await waitFor(() => expect(onAsk).toHaveBeenCalled());
    // FRONTEND.md: "The client never decides this."
    expect(screen.queryByRole('button', { name: /send my number/i })).not.toBeInTheDocument();
  });

  it('offers the card when the server says it qualified', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValue(
        streamOf('data: {"type":"done","conversationId":"c1","intent":{"qualified":true}}\n\n'),
      );
    render(
      <AskSheet
        seed="nak 2kg"
        shopName="Nadia Bakes"
        onClose={vi.fn()}
        onAsk={onAsk}
        onCapture={vi.fn()}
      />,
    );

    expect(await screen.findByRole('button', { name: /send my number/i })).toBeInTheDocument();
  });

  it('does not offer the card when no capture handler was given', async () => {
    // A personal page renders the sheet without one. Offering a field that
    // posts nowhere would be worse than not offering it.
    const onAsk = vi
      .fn()
      .mockResolvedValue(
        streamOf('data: {"type":"done","conversationId":"c1","intent":{"qualified":true}}\n\n'),
      );
    render(<AskSheet seed="nak 2kg" shopName="Nadia Bakes" onClose={vi.fn()} onAsk={onAsk} />);

    await waitFor(() => expect(onAsk).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /send my number/i })).not.toBeInTheDocument();
  });
});
