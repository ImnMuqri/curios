import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMode, type ChatModeProps } from './ChatMode.js';

function streamOf(...events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });
}

/**
 * A minimal stand-in for `apps/web/app/[handle]/ask.tsx`'s own `open` state,
 * so tests can prove the thread survives a close/reopen cycle the way the
 * real caller keeps ChatMode mounted -- without depending on `Ask` or
 * `AskBar` at all, which is what `ask.test.tsx` covers instead.
 */
function Harness(props: Omit<ChatModeProps, 'open' | 'onClose'>) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        reopen
      </button>
      <ChatMode {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.style.overflow = '';
});

describe('ChatMode, entering', () => {
  it('shows a greeting, up to four chips, and sends nothing until one is chosen', async () => {
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(
      <ChatMode
        open
        onClose={vi.fn()}
        onAsk={onAsk}
        displayName="Nadia Bakes"
        questions={['Berapa harga?', 'Buka bila?', 'Ada delivery?', 'Boleh custom?', 'Lokasi kat mana?']}
      />,
    );

    const dialog = await screen.findByRole('dialog', { name: 'Chat with Nadia Bakes' });
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByText('Hi! What do you want to know about Nadia Bakes?'),
    ).toBeInTheDocument();

    for (const q of ['Berapa harga?', 'Buka bila?', 'Ada delivery?', 'Boleh custom?']) {
      expect(screen.getByRole('button', { name: q })).toBeInTheDocument();
    }
    // A fifth suggestion exists on this page, but only four are ever shown.
    expect(screen.queryByRole('button', { name: 'Lokasi kat mana?' })).not.toBeInTheDocument();

    expect(onAsk).not.toHaveBeenCalled();
  });

  it('focuses the composer on entry, not a close control', async () => {
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await waitFor(() => expect(screen.getByLabelText('Ask a question')).toHaveFocus());
  });

  it('renders nothing visible, and drops out of the accessibility tree, while closed', () => {
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(
      <ChatMode open={false} onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('pushes exactly one history entry on entry, even under Strict Mode', () => {
    const pushSpy = vi.spyOn(history, 'pushState');
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(
      <StrictMode>
        <ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />
      </StrictMode>,
    );

    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('locks page scroll while open, and restores it on close', () => {
    const original = document.body.style.overflow;
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    const { rerender } = render(
      <ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />,
    );

    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <ChatMode open={false} onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />,
    );
    expect(document.body.style.overflow).toBe(original);
  });

  // React mounts every component twice in development, on purpose. With no
  // seed to auto-send anymore this should already be a non-event, but the
  // guard this once protected -- against something firing `onAsk` from an
  // effect before the visitor has done anything -- is exactly the kind of
  // thing a later change could quietly reintroduce.
  it('sends nothing under Strict Mode double-mounting, before anything is tapped', async () => {
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(
      <StrictMode>
        <ChatMode
          open
          onClose={vi.fn()}
          onAsk={onAsk}
          displayName="Nadia Bakes"
          questions={['Berapa harga?']}
        />
      </StrictMode>,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onAsk).not.toHaveBeenCalled();
  });
});

describe('ChatMode, asking', () => {
  it('sends the tapped chip, and the streamed answer renders', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValue(
        streamOf('data: {"type":"text","text":"RM45 "}\n\n', 'data: {"type":"text","text":"sekilo."}\n\n'),
      );
    render(
      <ChatMode
        open
        onClose={vi.fn()}
        onAsk={onAsk}
        displayName="Nadia Bakes"
        questions={['Berapa harga?']}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Berapa harga?' }));

    await waitFor(() => expect(onAsk).toHaveBeenCalledWith('Berapa harga?', null));
    await waitFor(() => expect(screen.getByText(/RM45 sekilo\./)).toBeInTheDocument());
  });

  it('sends the typed question on submit', async () => {
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await userEvent.type(screen.getByLabelText('Ask a question'), 'ada delivery?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onAsk).toHaveBeenCalledWith('ada delivery?', null));
  });

  it('handles an event split across two chunks', async () => {
    // SSE events routinely straddle chunk boundaries. Solved once already;
    // the fix travels with the code rather than being rediscovered.
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"text","tex', 't":"split"}\n\n'));
    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await userEvent.type(screen.getByLabelText('Ask a question'), 'q');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText(/split/)).toBeInTheDocument());
  });

  it('replaces a half answer with the error rather than appending to it', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValue(
        streamOf(
          'data: {"type":"text","text":"RM"}\n\n',
          'data: {"type":"error","message":"That answer failed. Try again."}\n\n',
        ),
      );
    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await userEvent.type(screen.getByLabelText('Ask a question'), 'q');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(screen.getByText('That answer failed. Try again.')).toBeInTheDocument(),
    );
    expect(screen.queryByText(/^RM$/)).not.toBeInTheDocument();
  });

  it('says something useful when the request never lands', async () => {
    const onAsk = vi.fn().mockRejectedValue(new Error('offline'));
    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await userEvent.type(screen.getByLabelText('Ask a question'), 'q');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText(/try again/i)).toBeInTheDocument());
  });

  it('will not send an empty question', async () => {
    const onAsk = vi.fn();
    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('does not send while an answer is still streaming', async () => {
    const onAsk = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await userEvent.type(screen.getByLabelText('Ask a question'), 'q');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled());
  });

  it('starts a fresh thread when the conversation has expired', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValueOnce(streamOf('data: {"type":"done","conversationId":"c1"}\n\n'))
      .mockResolvedValueOnce(
        streamOf(
          'data: {"type":"error","code":"CONVERSATION_NOT_FOUND","message":"That answer failed. Try again."}\n\n',
        ),
      )
      .mockResolvedValueOnce(streamOf('data: {"type":"done","conversationId":"c2"}\n\n'));

    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await userEvent.type(screen.getByLabelText('Ask a question'), 'one');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(1));

    await userEvent.type(screen.getByLabelText('Ask a question'), 'two');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(2));

    await userEvent.type(screen.getByLabelText('Ask a question'), 'three');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onAsk).toHaveBeenLastCalledWith('three', null));
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

    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await userEvent.type(screen.getByLabelText('Ask a question'), 'harga?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith('harga?', null));

    await userEvent.type(screen.getByLabelText('Ask a question'), 'ada delivery?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

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

    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await userEvent.type(screen.getByLabelText('Ask a question'), 'harga?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText(/RM45 sekilo/)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Ask a question'), 'ada delivery?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByText(/Ya, boleh/)).toBeInTheDocument());
    expect(screen.getByText(/RM45 sekilo/)).toBeInTheDocument();
    expect(screen.getByText('harga?')).toBeInTheDocument();
    expect(screen.getByText('ada delivery?')).toBeInTheDocument();
  });
});

describe('ChatMode, leaving', () => {
  it('closes on the back button, consuming the pushed history entry', async () => {
    const onClose = vi.fn();
    const backSpy = vi.spyOn(history, 'back').mockImplementation(() => {});
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(<ChatMode open onClose={onClose} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Back to links' }));

    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on escape, consuming the pushed history entry', async () => {
    const onClose = vi.fn();
    const backSpy = vi.spyOn(history, 'back').mockImplementation(() => {});
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(<ChatMode open onClose={onClose} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await userEvent.keyboard('{Escape}');

    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when a popstate fires -- the browser or phone back gesture', () => {
    const onClose = vi.fn();
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(<ChatMode open onClose={onClose} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    fireEvent(window, new PopStateEvent('popstate'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('is a modal dialog, so focus and the accessibility tree agree', async () => {
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('keeps the thread across a close and reopen', async () => {
    vi.spyOn(history, 'back').mockImplementation(() => {});
    const onAsk = vi
      .fn()
      .mockResolvedValue(
        streamOf('data: {"type":"text","text":"RM45"}\n\n', 'data: {"type":"done","conversationId":"c1"}\n\n'),
      );

    render(<Harness onAsk={onAsk} displayName="Nadia Bakes" questions={['Berapa harga?']} />);

    await userEvent.click(screen.getByRole('button', { name: 'Berapa harga?' }));
    await waitFor(() => expect(screen.getByText(/RM45/)).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Back to links' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'reopen' }));
    expect(screen.getByText(/RM45/)).toBeInTheDocument();
    expect(screen.getByText('Berapa harga?')).toBeInTheDocument();
    // The empty state -- greeting and chips -- must not come back once a
    // turn exists; that would look like the thread had been forgotten.
    expect(screen.queryByText(/Hi! What do you want to know/)).not.toBeInTheDocument();
  });
});

describe('ChatMode, the capture card', () => {
  it('offers the card only when the server says the conversation qualified', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValue(
        streamOf('data: {"type":"done","conversationId":"c1","intent":{"qualified":false}}\n\n'),
      );
    render(
      <ChatMode
        open
        onClose={vi.fn()}
        onAsk={onAsk}
        displayName="Nadia Bakes"
        questions={[]}
        onCapture={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByLabelText('Ask a question'), 'q');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
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
      <ChatMode
        open
        onClose={vi.fn()}
        onAsk={onAsk}
        displayName="Nadia Bakes"
        questions={[]}
        onCapture={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByLabelText('Ask a question'), 'nak 2kg');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('button', { name: /send my number/i })).toBeInTheDocument();
  });

  it('does not offer the card when no capture handler was given', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValue(
        streamOf('data: {"type":"done","conversationId":"c1","intent":{"qualified":true}}\n\n'),
      );
    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await userEvent.type(screen.getByLabelText('Ask a question'), 'nak 2kg');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onAsk).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: /send my number/i })).not.toBeInTheDocument();
  });
});

describe('ChatMode, styling', () => {
  it('renders the owner picture when given, and nothing when there is none', () => {
    // alt="" is deliberate -- the name sits right next to it as visible text
    // -- which drops the image out of the accessible "img" role, so this
    // reaches it as a plain DOM node instead of through screen.getByRole.
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    const { container, rerender } = render(
      <ChatMode
        open
        onClose={vi.fn()}
        onAsk={onAsk}
        displayName="Nadia Bakes"
        avatarUrl="https://cdn.example/a.webp"
        questions={[]}
      />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/a.webp');

    rerender(
      <ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />,
    );
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  // Fix round 2, Important #2: the spec says the accent paints "the chat
  // sheet's highlights" -- the send button and the composer's focus ring --
  // not a fixed --hijau. Read the way design-rules.test.ts reads a
  // stylesheet: this package's vitest config has no `css: true`, so a
  // rendered element's computed style here would not reflect BentoPage's
  // cascade regardless.
  it('reads its send button and focus ring from BentoPage-supplied accent variables, with a fallback', () => {
    const css = readFileSync(join(import.meta.dirname, 'ChatMode.module.css'), 'utf8');
    expect(css).toMatch(/border-color:\s*var\(--accent,\s*var\(--hijau\)\)/);
    expect(css).toMatch(/background:\s*var\(--accent,\s*var\(--hijau\)\)/);
    expect(css).toMatch(/color:\s*var\(--on-accent,\s*var\(--paper\)\)/);
  });
});
