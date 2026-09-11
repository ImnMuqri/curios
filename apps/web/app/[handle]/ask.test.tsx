import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ask } from './ask.js';

/**
 * Step 5's finding: `page.test.tsx` renders `HandlePage` and asserts only
 * that the ask bar appears, which is true whatever `canCapture` is -- opening
 * the sheet and reaching a qualified conversation never happens at that
 * level. Hard-coding `canCapture={false}` in page.tsx left every test there
 * green. `Ask` is the one place that turns the `canCapture` prop into
 * whether the sheet is EVER given a capture handler at all
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

describe('Ask, once a conversation qualifies', () => {
  it('offers the capture card when the page can capture', async () => {
    stubQualifyingFetch();
    render(<Ask handle="nadia" questions={['Berapa harga?']} shopName="Nadia Bakes" canCapture={true} />);

    await userEvent.click(screen.getByRole('button', { name: /ask a question/i }));

    expect(await screen.findByRole('button', { name: /send my number/i })).toBeInTheDocument();
  });

  it('never offers the capture card when the page cannot capture', async () => {
    stubQualifyingFetch();
    render(<Ask handle="nadia" questions={['Berapa harga?']} shopName="Nadia Bakes" canCapture={false} />);

    await userEvent.click(screen.getByRole('button', { name: /ask a question/i }));

    // The same qualifying response as above lands either way; only the prop differs.
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /send my number/i })).not.toBeInTheDocument();
  });
});
