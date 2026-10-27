import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ask } from './ask.js';

/**
 * Step 5's finding: `page.test.tsx` renders `HandlePage` and asserts only
 * that the page renders, which is true whatever `canCapture` is -- opening
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

  it('puts no ask bar on the links, as the Public board has it, and sends nothing before a tap', () => {
    stubQualifyingFetch();
    render(<Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={true} />);

    // The opening line is chat mode's own greeting (shown by CSS
    // only in chat mode), server-rendered so a no-JS visitor still sees it.
    expect(screen.getByText('Hi! I’m Nadia Bakes’s page. Ask me about what’s on offer, prices or how to order.').closest('[data-ask-prompt]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /ask a question/i })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('enters chat mode on the page it is part of, not a layer over it', async () => {
    stubQualifyingFetch();
    const { container } = render(
      <TabbedPage>
        <Ask
          handle="nadia"
          questions={['Berapa harga?']}
          displayName="Nadia Bakes"
          canCapture={true}
        />
      </TabbedPage>,
    );

    await userEvent.click(screen.getByRole('link', { name: 'Ask' }));
    // Chat mode loads on first use.
    await screen.findByRole('button', { name: 'Back to links' });

    // Set on the ancestor BentoPage renders, not on anything Ask/ChatMode
    // owns themselves -- BentoPage is a server component and holds no chat
    // state of its own, so this is how the client side reaches it at all.
    expect(container.querySelector('[data-bento-page]')).toHaveAttribute('data-mode', 'chat');
    expect(screen.getByRole('button', { name: 'Back to links' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Berapa harga?' })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('hides the prompt once a turn exists, and marks that on the page too', async () => {
    stubQualifyingFetch();
    const { container } = render(
      <TabbedPage>
        <Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={true} />
      </TabbedPage>,
    );

    await userEvent.click(screen.getByRole('link', { name: 'Ask' }));
    expect(screen.getByText('Hi! I’m Nadia Bakes’s page. Ask me about what’s on offer, prices or how to order.')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Berapa harga?' }));

    await waitFor(() =>
      expect(container.querySelector('[data-bento-page]')).toHaveAttribute('data-has-turns', 'true'),
    );
  });

  it('returns focus to the Ask tab once chat mode closes', async () => {
    stubQualifyingFetch();
    vi.spyOn(history, 'back').mockImplementation(() => {});
    render(
      <TabbedPage>
        <Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={true} />
      </TabbedPage>,
    );

    const askTab = screen.getByRole('link', { name: 'Ask' });
    await userEvent.click(askTab);
    await screen.findByRole('button', { name: 'Back to links' });

    await userEvent.click(screen.getByRole('button', { name: 'Back to links' }));

    expect(screen.queryByRole('button', { name: 'Back to links' })).not.toBeInTheDocument();
    expect(askTab).toHaveFocus();
  });
});

describe('Ask, arriving with a question', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('opens chat mode with ?q= typed in, and sends nothing until the visitor does', async () => {
    stubQualifyingFetch();
    window.history.replaceState(null, '', '/nadia?q=I%20have%20a%20question%20about%20Kek%20Batik.#ask');
    render(
      <TabbedPage>
        <Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={true} />
      </TabbedPage>,
    );
    const input = await screen.findByRole('textbox', { name: 'Ask a question' });
    expect(input).toHaveValue('I have a question about Kek Batik.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores ?q= without #ask, and opens with an empty box with #ask alone', async () => {
    stubQualifyingFetch();
    window.history.replaceState(null, '', '/nadia?q=Hello');
    const first = render(
      <TabbedPage>
        <Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={true} />
      </TabbedPage>,
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.queryByRole('textbox', { name: 'Ask a question' })).toBeNull();
    first.unmount();

    window.history.replaceState(null, '', '/nadia#ask');
    render(
      <TabbedPage>
        <Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={true} />
      </TabbedPage>,
    );
    expect(await screen.findByRole('textbox', { name: 'Ask a question' })).toHaveValue('');
  });
});

describe('Ask, once a conversation qualifies', () => {
  it('offers the capture card when the page can capture', async () => {
    stubQualifyingFetch();
    render(
      <TabbedPage>
        <Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={true} />
      </TabbedPage>,
    );

    await userEvent.click(screen.getByRole('link', { name: 'Ask' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Berapa harga?' }));

    expect(await screen.findByRole('button', { name: /send my number/i })).toBeInTheDocument();
  });

  it('never offers the capture card when the page cannot capture', async () => {
    stubQualifyingFetch();
    render(
      <TabbedPage>
        <Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={false} />
      </TabbedPage>,
    );

    await userEvent.click(screen.getByRole('link', { name: 'Ask' }));
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

/** BentoPage's tabs, as server-rendered links, around Ask. */
function TabbedPage({ children }: { children: React.ReactNode }) {
  return (
    <div data-bento-page>
      <nav aria-label="Page sections">
        <a href="/nadia" data-tab="links" aria-current="page">Links</a>
        <a href="/nadia#ask" data-tab="ask">Ask</a>
      </nav>
      <div data-foldaway>links go here</div>
      {children}
    </div>
  );
}

describe('Ask, and the page tabs', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('opens chat mode in place from the Ask tab, and makes it the current tab', async () => {
    stubQualifyingFetch();
    const { container } = render(
      <TabbedPage>
        <Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={true} />
      </TabbedPage>,
    );

    await userEvent.click(screen.getByRole('link', { name: 'Ask' }));

    expect(container.querySelector('[data-bento-page]')).toHaveAttribute('data-mode', 'chat');
    expect(screen.getByRole('link', { name: 'Ask' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Links' })).not.toHaveAttribute('aria-current');
  });

  it('goes back to the links from the Links tab while chat mode is open', async () => {
    stubQualifyingFetch();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    const { container } = render(
      <TabbedPage>
        <Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={true} />
      </TabbedPage>,
    );

    await userEvent.click(screen.getByRole('link', { name: 'Ask' }));
    await userEvent.click(screen.getByRole('link', { name: 'Links' }));

    // Through history, so the entry chat mode pushed is the one consumed.
    expect(back).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(container.querySelector('[data-bento-page]')).not.toHaveAttribute('data-mode'));
    expect(screen.getByRole('link', { name: 'Links' })).toHaveAttribute('aria-current', 'page');
    back.mockRestore();
  });

  it('opens chat mode on arrival at #ask, where the shop page and the FAQ send a visitor', async () => {
    stubQualifyingFetch();
    window.history.replaceState(null, '', '/nadia#ask');
    const { container } = render(
      <TabbedPage>
        <Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={true} />
      </TabbedPage>,
    );

    await waitFor(() => expect(container.querySelector('[data-bento-page]')).toHaveAttribute('data-mode', 'chat'));
  });

  it('offers to browse the answered questions when there are any', () => {
    render(<Ask handle="nadia" questions={[]} displayName="Nadia Bakes" canCapture={true} faqTotal={5} />);
    expect(screen.getByRole('link', { name: /Browse 5 answered questions/ })).toHaveAttribute('href', '/nadia/faq');
  });
});

describe('Ask, the product card', () => {
  const productCard = { itemId: 'i1', slug: 'kek-batik', name: 'Kek Batik', fromPriceCents: 9500, photoUrl: null, firstOptionId: 'o1', buy: 'add' };

  function stubNamingFetch(card: object = productCard) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const enc = new TextEncoder();
              controller.enqueue(enc.encode('data: {"type":"text","text":"Kek batik is RM95."}\n\n'));
              controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'done', conversationId: 'c1', intent: { qualified: false }, productCard: card })}\n\n`));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      ),
    );
  }

  async function askAboutBatik(language?: string) {
    render(
      <TabbedPage>
        <Ask handle="nadia" questions={['Berapa harga?']} displayName="Nadia Bakes" canCapture={false} language={language} />
      </TabbedPage>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'Ask' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Berapa harga?' }));
  }

  afterEach(() => window.sessionStorage.clear());

  it('a class card sends the visitor to the item page for a time, adding nothing; a sold-out one is not offered', async () => {
    stubNamingFetch({ ...productCard, buy: 'pick' });
    await askAboutBatik();
    expect(await screen.findByRole('link', { name: 'Pick a time' })).toHaveAttribute('href', '/nadia/shop/kek-batik');
    expect(screen.queryByRole('button', { name: 'Add to basket' })).toBeNull();
    expect(window.sessionStorage.getItem('curios-basket:nadia')).toBeNull();
  });

  it('Add to basket writes the first option into the shop’s basket and turns into "In your basket"', async () => {
    stubNamingFetch();
    const seen = vi.fn();
    window.addEventListener('curios-basket', seen);
    await askAboutBatik();

    await userEvent.click(await screen.findByRole('button', { name: 'Add to basket' }));

    expect(JSON.parse(window.sessionStorage.getItem('curios-basket:nadia') ?? '[]')).toEqual([{ itemId: 'i1', optionId: 'o1', quantity: 1 }]);
    expect(seen).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'In your basket' })).toBeInTheDocument();
    window.removeEventListener('curios-basket', seen);
  });

  it('says "In your basket" straight away when the basket already holds the item (a reload)', async () => {
    window.sessionStorage.setItem('curios-basket:nadia', JSON.stringify([{ itemId: 'i1', optionId: 'o1', quantity: 2 }]));
    stubNamingFetch();
    await askAboutBatik();
    expect(await screen.findByRole('button', { name: 'In your basket' })).toBeInTheDocument();
  });

  it('opens and labels itself in Malay on a Malay page', async () => {
    stubNamingFetch();
    await askAboutBatik('ms');
    expect(screen.getByText('Hai! Saya halaman Nadia Bakes. Tanya saya tentang apa yang ditawarkan, harga atau cara menempah.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Masuk bakul' })).toBeInTheDocument();
    expect(screen.getByText('Halaman Nadia Bakes')).toBeInTheDocument();
  });
});

describe('Ask, and the document behind the page', () => {
  it('paints the document in the page’s colour, so a phone shows no white band under it, and puts it back after', () => {
    const { unmount } = render(
      <div data-bento-page style={{ backgroundColor: 'rgb(26, 31, 44)' }}>
        <Ask handle="nadia" questions={[]} displayName="Nadia Bakes" canCapture={false} />
      </div>,
    );
    expect(document.documentElement.style.backgroundColor).toBe('rgb(26, 31, 44)');

    unmount();
    expect(document.documentElement.style.backgroundColor).toBe('');
  });
});
