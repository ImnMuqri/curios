import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ask } from './ask.js';

/**
 * Step 5's finding: `page.test.tsx` renders `HandlePage` and asserts only
 * that the ask bar appears, which is true whatever `canCapture` is -- opening
 * chat mode and reaching a qualified conversation never happens at that
 * level. Hard-coding `canCapture={false}` in page.tsx left every test there
 * green. `Ask` is the one place that turns the `canCapture` prop into
 * whether chat mode is EVER given a capture handler at all
 * (`onCapture={canCapture ? onCapture : undefined}`), so this drives `Ask`
 * itself through a real qualifying conversation and asserts on the capture
 * card's presence -- the actual behaviour the gate exists to control, not
 * the prop's own value and not `canCapture()` from `@curios/core` again.
 */
function stubQualifyingFetch() {
  const spy = vi.fn(async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"type":"done","conversationId":"c1","intent":{"qualified":true}}\n\n',
            ),
          );
          controller.close();
        },
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal('fetch', spy);
}

afterEach(() => vi.unstubAllGlobals());

describe('Ask, opening chat mode', () => {
  it('mounts chat mode only once opened, not on the cold page', async () => {
    stubQualifyingFetch();
    const { container } = render(
      <Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={true} />,
    );

    // Long enough for the dynamic import to resolve, if the JSX branch that
    // triggers it was reached at all -- a synchronous assertion right after
    // render would pass whether or not chat mode is gated, since `next/dynamic`
    // resolves asynchronously either way. Waiting is what makes this able to
    // tell "never mounted" apart from "mounted, but not finished loading yet".
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    // The budget the dynamic import exists for: nothing of chat mode's own
    // DOM should exist before the visitor has ever tapped the bar, hidden or
    // not -- `container.querySelector` sees a hidden node too, unlike
    // `screen.getByRole`, so this would catch chat mode being mounted eagerly
    // and merely hidden rather than not mounted at all.
    expect(container.querySelector('[aria-label="Back to links"]')).not.toBeInTheDocument();
  });

  it('enters chat mode with nothing sent, and passes displayName and avatarUrl through', async () => {
    stubQualifyingFetch();
    render(
      <Ask
        handle="nadia"
        questions={['Berapa harga?']}
        displayName="Nadia Bakes"
        avatarUrl="https://cdn.example/nadia.webp"
        canCapture={true}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /ask a question/i }));

    const dialog = await screen.findByRole('dialog', { name: 'Chat with Nadia Bakes' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Hi! What do you want to know about Nadia Bakes?')).toBeInTheDocument();
    expect(dialog.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/nadia.webp');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns focus to the ask bar once chat mode closes', async () => {
    stubQualifyingFetch();
    vi.spyOn(history, 'back').mockImplementation(() => {});
    render(<Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={true} />);

    const askBar = screen.getByRole('button', { name: /ask a question/i });
    await userEvent.click(askBar);
    await screen.findByRole('dialog');

    await userEvent.click(screen.getByRole('button', { name: 'Back to links' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(askBar).toHaveFocus();
  });
});

describe('Ask, once a conversation qualifies', () => {
  it('offers the capture card when the page can capture', async () => {
    stubQualifyingFetch();
    render(<Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={true} />);

    await userEvent.click(screen.getByRole('button', { name: /ask a question/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Berapa harga?' }));

    expect(await screen.findByRole('button', { name: /send my number/i })).toBeInTheDocument();
  });

  it('never offers the capture card when the page cannot capture', async () => {
    stubQualifyingFetch();
    render(<Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={false} />);

    await userEvent.click(screen.getByRole('button', { name: /ask a question/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Berapa harga?' }));

    // The same qualifying response as above lands either way; only the prop
    // differs. Waited on the composer leaving its busy state -- set at the
    // start of ChatMode's `send` and cleared only in its `finally`, so this is
    // stream completion, not just dispatch -- rather than on `fetch` having
    // been called, which proves only that a request went out. That keeps this
    // a real regression check: it would still catch `onCapture` ever being
    // forwarded unconditionally, instead of racing the stream and passing by
    // accident.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' })).not.toHaveAttribute('aria-busy'),
    );
    expect(screen.queryByRole('button', { name: /send my number/i })).not.toBeInTheDocument();
  });
});
