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
 * The DOM shape `BentoPage` actually renders, reduced to what `ChatMode`
 * looks for: a `[data-bento-page]` ancestor to toggle `data-mode`/`data-has-turns`
 * on, and a `[data-foldaway]` block -- with something real and focusable
 * inside it, standing in for the bio and the tile grid -- that chat mode
 * marks `inert` while open. `Ask`'s own bar is not part of this harness;
 * `ask.test.tsx` covers the real wiring end to end.
 */
function PageHarness({ children }: { children: React.ReactNode }) {
  return (
    <div data-bento-page>
      <div data-foldaway>
        <a href="https://example.com">A bento link</a>
      </div>
      {children}
    </div>
  );
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
    <PageHarness>
      <button type="button" onClick={() => setOpen(true)}>
        reopen
      </button>
      <ChatMode {...props} open={open} onClose={() => setOpen(false)} />
    </PageHarness>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatMode, entering', () => {
  it('sets data-mode="chat" on the page root, shows the chips, and sends nothing until one is chosen', async () => {
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    const { container } = render(
      <PageHarness>
        <ChatMode
          open
          onClose={vi.fn()}
          onAsk={onAsk}
          displayName="Nadia Bakes"
          questions={['Berapa harga?', 'Buka bila?', 'Ada delivery?', 'Boleh custom?', 'Lokasi kat mana?']}
        />
      </PageHarness>,
    );

    const page = container.querySelector('[data-bento-page]');
    expect(page).toHaveAttribute('data-mode', 'chat');

    expect(screen.getByRole('button', { name: 'Back to links' })).toBeInTheDocument();
    for (const q of ['Berapa harga?', 'Buka bila?', 'Ada delivery?', 'Boleh custom?']) {
      expect(screen.getByRole('button', { name: q })).toBeInTheDocument();
    }
    // A fifth suggestion exists on this page, but only four are ever shown.
    expect(screen.queryByRole('button', { name: 'Lokasi kat mana?' })).not.toBeInTheDocument();

    expect(onAsk).not.toHaveBeenCalled();
  });

  // Important #2: an unmount used to leave data-mode, data-has-turns, inert
  // and aria-hidden all stuck on the ancestor page forever, since neither
  // effect returned a cleanup -- an error boundary, a route change tearing
  // this component down without the page around it, or Strict Mode's own
  // mount/unmount/remount could each strand the bento hidden and inert with
  // nothing left alive to ever undo it.
  it('clears data-mode, data-has-turns, inert and aria-hidden on unmount, even while open with a turn', async () => {
    const onAsk = vi
      .fn()
      .mockResolvedValue(streamOf('data: {"type":"text","text":"RM45"}\n\n', 'data: {"type":"done"}\n\n'));
    const { container, unmount } = render(
      <PageHarness>
        <ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />
      </PageHarness>,
    );

    await userEvent.type(screen.getByLabelText('Ask a question'), 'harga?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    const page = container.querySelector('[data-bento-page]') as HTMLElement;
    const foldaway = container.querySelector('[data-foldaway]') as HTMLElement;
    await waitFor(() => expect(page).toHaveAttribute('data-has-turns', 'true'));
    expect(page).toHaveAttribute('data-mode', 'chat');
    expect(foldaway).toHaveAttribute('aria-hidden', 'true');
    expect(foldaway.inert).toBe(true);

    unmount();

    expect(page).not.toHaveAttribute('data-mode');
    expect(page).not.toHaveAttribute('data-has-turns');
    expect(foldaway).not.toHaveAttribute('aria-hidden');
    expect(foldaway.inert).toBe(false);
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

    expect(screen.queryByRole('button', { name: 'Back to links' })).not.toBeInTheDocument();
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

  it('scrolls the latest line of the thread into view as it grows, instead of locking page scroll', async () => {
    // Nothing here is position: fixed anymore, so a body-scroll lock would
    // just fight the visitor's own scrolling; this replaced it. Spied on
    // HTMLElement's own prototype, not Element's -- that is where
    // vitest.setup.ts's stub for jsdom's missing scrollIntoView lives, and it
    // is closer than Element.prototype on a real element's chain, so a spy
    // placed on Element.prototype would never be reached at all.
    const scrollSpy = vi
      .spyOn(window.HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => {});
    const onAsk = vi
      .fn()
      .mockResolvedValue(
        streamOf('data: {"type":"text","text":"RM45 "}\n\n', 'data: {"type":"text","text":"sekilo."}\n\n'),
      );
    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    expect(scrollSpy).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Ask a question'), 'harga?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
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

  // Fix round 1, Important #1: carried over from the deleted AskSheet suite.
  // FRONTEND.md's accessibility floor calls this non-negotiable -- a
  // streamed answer must announce politely, not silently or interrupting.
  it('announces the answer politely', async () => {
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"text","text":"RM45"}\n\n'));
    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await userEvent.type(screen.getByLabelText('Ask a question'), 'harga?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    const live = await screen.findByRole('status');
    await waitFor(() => expect(live).toHaveTextContent('RM45'));
    expect(live).toHaveAttribute('aria-live', 'polite');
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

  // Fix round 1, Important #4: `leave` used to call `onClose` unconditionally,
  // even on a second invocation after it had already consumed the pushed
  // history entry. Two Escapes in quick succession -- before the parent has
  // had a chance to re-render with `open={false}` -- used to tell the parent
  // to close chat mode twice.
  it('does not call onClose a second time for a second close in a row', async () => {
    const onClose = vi.fn();
    vi.spyOn(history, 'back').mockImplementation(() => {});
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(<ChatMode open onClose={onClose} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when a popstate fires -- the browser or phone back gesture', () => {
    const onClose = vi.fn();
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(<ChatMode open onClose={onClose} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    fireEvent(window, new PopStateEvent('popstate'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('removes the bento grid and bio from the tab order and accessibility tree while open, and restores both on close', async () => {
    vi.spyOn(history, 'back').mockImplementation(() => {});
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    const { container } = render(
      <Harness onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />,
    );

    const foldaway = container.querySelector('[data-foldaway]');
    expect(foldaway).toHaveAttribute('aria-hidden', 'true');
    expect((foldaway as HTMLElement).inert).toBe(true);
    expect(screen.queryByRole('link', { name: 'A bento link' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Back to links' }));

    expect(foldaway).not.toHaveAttribute('aria-hidden');
    expect((foldaway as HTMLElement).inert).toBe(false);
    expect(screen.getByRole('link', { name: 'A bento link' })).toBeInTheDocument();
    expect(container.querySelector('[data-bento-page]')).not.toHaveAttribute('data-mode');
  });

  // Minor: the close path above proves the attributes come OFF; this proves
  // they go back ON a second time, not just once -- the effect's guard logic
  // (Strict-Mode double-invoke protection on the history push, separately)
  // must not accidentally leave the DOM-sync effect thinking there is
  // nothing left to do on a reopen.
  it('reapplies data-mode, inert and aria-hidden on a second open', async () => {
    vi.spyOn(history, 'back').mockImplementation(() => {});
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    const { container } = render(<Harness onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    const page = container.querySelector('[data-bento-page]') as HTMLElement;
    const foldaway = container.querySelector('[data-foldaway]') as HTMLElement;
    expect(page).toHaveAttribute('data-mode', 'chat');
    expect(foldaway).toHaveAttribute('aria-hidden', 'true');
    expect(foldaway.inert).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Back to links' }));
    expect(page).not.toHaveAttribute('data-mode');
    expect(foldaway).not.toHaveAttribute('aria-hidden');
    expect(foldaway.inert).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'reopen' }));
    expect(page).toHaveAttribute('data-mode', 'chat');
    expect(foldaway).toHaveAttribute('aria-hidden', 'true');
    expect(foldaway.inert).toBe(true);
  });

  it('is a plain part of the page: no fixed overlay, and no second copy of the display name', () => {
    const onAsk = vi.fn().mockResolvedValue(streamOf('data: {"type":"done"}\n\n'));
    render(<ChatMode open onClose={vi.fn()} onAsk={onAsk} displayName="Nadia Bakes" questions={[]} />);

    // BentoPage's own header renders the name; this component must not
    // repeat it -- the owner's complaint about the first version was that a
    // full-screen layer "looks like it opened another page", and a second
    // header would carry the same problem in miniature.
    expect(screen.queryByText('Nadia Bakes')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    const css = readFileSync(join(import.meta.dirname, 'ChatMode.module.css'), 'utf8');
    expect(css).not.toMatch(/position:\s*fixed/);
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
    expect(screen.queryByRole('button', { name: 'Back to links' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'reopen' }));
    expect(screen.getByText(/RM45/)).toBeInTheDocument();
    expect(screen.getByText('Berapa harga?')).toBeInTheDocument();
    // The empty-state chips must not come back once a turn exists; that
    // would look like the thread had been forgotten.
    expect(screen.queryByRole('button', { name: 'Berapa harga?' })).not.toBeInTheDocument();
  });

  // Fix round 1, Important #2: brief test #3 in full -- the previous test only
  // proved the transcript survives a close/reopen, not that the conversation
  // id does too. A second question after reopening must still carry the id
  // the first `done` returned, not start a new thread.
  it('carries the conversation id across a close and reopen, not just across turns in one sitting', async () => {
    vi.spyOn(history, 'back').mockImplementation(() => {});
    const onAsk = vi
      .fn()
      .mockResolvedValueOnce(
        streamOf(
          'data: {"type":"text","text":"RM45"}\n\n',
          'data: {"type":"done","conversationId":"c-1"}\n\n',
        ),
      )
      .mockResolvedValueOnce(streamOf('data: {"type":"done","conversationId":"c-1"}\n\n'));

    render(<Harness onAsk={onAsk} displayName="Nadia Bakes" questions={['Berapa harga?']} />);

    await userEvent.click(screen.getByRole('button', { name: 'Berapa harga?' }));
    await waitFor(() => expect(onAsk).toHaveBeenCalledWith('Berapa harga?', null));
    await waitFor(() => expect(screen.getByText(/RM45/)).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Back to links' }));
    expect(screen.queryByRole('button', { name: 'Back to links' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'reopen' }));
    expect(screen.getByText(/RM45/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Ask a question'), 'ada delivery?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onAsk).toHaveBeenLastCalledWith('ada delivery?', 'c-1'));
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
  // Fix round 2, Important #2: the spec says the accent paints "the chat
  // sheet's highlights" -- the send button and the composer's focus ring --
  // not a fixed --biru. Read the way design-rules.test.ts reads a
  // stylesheet: this package's vitest config has no `css: true`, so a
  // rendered element's computed style here would not reflect BentoPage's
  // cascade regardless.
  it('reads its send button and focus ring from BentoPage-supplied accent variables, with a fallback', () => {
    const css = readFileSync(join(import.meta.dirname, 'ChatMode.module.css'), 'utf8');
    expect(css).toMatch(/border-color:\s*var\(--accent,\s*var\(--biru\)\)/);
    expect(css).toMatch(/background:\s*var\(--accent,\s*var\(--biru\)\)/);
    expect(css).toMatch(/color:\s*var\(--on-accent,\s*var\(--paper\)\)/);
  });

  // Fix round: the owner saw this live -- "the arrow back is in the middle
  // for some reason". `.panel { position: relative }` made `.panel` itself
  // the containing block for `.back`'s `position: absolute`, so the arrow
  // resolved against this panel's own place in the flow (down where the
  // chat content starts) instead of skipping past it to BentoPage's `.page`
  // (Bento.module.css, position: relative), which is what actually sits
  // beside the header. jsdom cannot render layout to catch this, so this
  // reads the stylesheet directly, the way every other CSS assertion in this
  // suite does. Bento.module.css's own test pins the other half of this
  // pairing: `.head[data-mode='chat']`'s padding-left, which only makes
  // sense once `.back` anchors to the right element.
  it('declares no position on .panel, so .back anchors to the page instead of this panel', () => {
    const css = readFileSync(join(import.meta.dirname, 'ChatMode.module.css'), 'utf8');
    const panelBlock = css.match(/(?<!\S)\.panel\s*\{([^}]*)\}/s)?.[1];
    expect(panelBlock).toBeDefined();
    expect(panelBlock).not.toMatch(/position:/);
  });
});
