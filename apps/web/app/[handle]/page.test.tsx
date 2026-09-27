import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PublicPage } from '@curios/db-read';
import { FREE_LEADS } from '@curios/core';

vi.mock('@curios/db-read', () => ({ getPublicPage: vi.fn(), getFaqIndex: vi.fn() }));

// Mocked so `HandlePage` can be inspected for what it decided, not just what
// `Ask` does with it -- `ask.test.tsx` already proves the prop-to-DOM half of
// this. Real `Ask` is a heavy client component (dynamic sheet import, fetch
// wiring); a mock lets these tests exercise only `page.tsx`'s own wiring of
// `canCapture` from real field values, without also depending on `Ask`'s
// internals for tests that were never about `Ask`.
vi.mock('./ask.js', () => ({ Ask: vi.fn(() => null) }));

const { getFaqIndex, getPublicPage } = await import('@curios/db-read');
const { Ask } = await import('./ask.js');
const HandlePage = (await import('./page.js')).default;

const page: PublicPage = {
  id: 'p1',
  handle: 'nadia',
  displayName: 'Nadia Bakes',
  bio: 'Kek butter, Shah Alam',
  language: 'ms',
  mode: 'BUSINESS',
  paidUntil: null,
  leadsCaptured: 0,
  links: [
    { id: 'l1', label: 'WhatsApp', url: 'https://wa.me/60123456789', icon: null, position: 0, size: null },
    { id: 'l2', label: 'Instagram', url: 'https://instagram.com/nadia', icon: null, position: 1, size: null },
  ],
  facts: [
    {
      id: 'f1',
      category: 'PRICE',
      claim: 'Kek 1kg butter starts at RM95',
      question: 'Berapa harga kek butter 1kg?',
    },
    // Null on purpose: every fact written before the question column existed
    // looks like this, and the page must not assume otherwise.
    { id: 'f2', category: 'HOURS', claim: 'Open Monday to Saturday', question: null },
  ],
  allowSearchIndexing: false,
  style: 'SOFT',
  accentColor: '#0c7a62',
  headingFont: 'JAKARTA',
  avatarKey: null,
};

describe('public page', () => {
  it('renders the owner name and every link as a real anchor', async () => {
    vi.mocked(getPublicPage).mockResolvedValue(page);
    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    expect(screen.getByText('Nadia Bakes')).toBeDefined();

    const whatsapp = screen.getByRole('link', { name: /whatsapp/i });
    expect(whatsapp.getAttribute('href')).toBe('https://wa.me/60123456789');
    expect(screen.getByRole('link', { name: /instagram/i })).toBeDefined();
  });

  // The page is the owner's links now; facts live behind the ask bar.
  it('shows no fact list', async () => {
    vi.mocked(getPublicPage).mockResolvedValue(page);
    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));
    expect(screen.queryByText(/what people ask/i)).toBeNull();
    expect(screen.queryByText(page.facts[0]!.claim)).toBeNull();
  });

  // Self-review addition: BentoPage.test.tsx proves these attributes render
  // from whatever props it is given, but nothing in this file proved page.tsx
  // itself forwards the page's OWN style/accent/font rather than a constant --
  // every other test here uses the fixture's defaults, so a hardcoded
  // '#0c7a62' or 'SOFT' in page.tsx would still leave them green.
  it("carries the page's own style, accent and heading font to the rendered page", async () => {
    vi.mocked(getPublicPage).mockResolvedValue({
      ...page,
      style: 'CONTRAST',
      accentColor: '#6d3fb3',
      headingFont: 'FRAUNCES',
    });
    const { container } = render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    const bento = container.querySelector('main > *') as HTMLElement;
    expect(bento).toHaveAttribute('data-style', 'CONTRAST');
    expect(bento.style.getPropertyValue('--accent')).toBe('#6d3fb3');
    expect(bento.style.getPropertyValue('--font-heading')).toBe('var(--font-fraunces)');
  });

  // Self-review addition: every other test's fixture has avatarKey: null, so
  // nothing here proved page.tsx turns a real key into a URL and passes it
  // through -- BentoPage.test.tsx only proves BentoPage renders whatever
  // avatarUrl string it is handed.
  it("shows the owner's picture when one was uploaded, through the public storage URL", async () => {
    const original = process.env.STORAGE_PUBLIC_URL;
    process.env.STORAGE_PUBLIC_URL = 'https://cdn.example';
    try {
      vi.mocked(getPublicPage).mockResolvedValue({ ...page, avatarKey: 'avatars/p/1.webp' });
      render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));
      expect(screen.getByRole('img', { name: page.displayName })).toHaveAttribute(
        'src',
        'https://cdn.example/avatars/p/1.webp',
      );
    } finally {
      if (original === undefined) delete process.env.STORAGE_PUBLIC_URL;
      else process.env.STORAGE_PUBLIC_URL = original;
    }
  });

  it('calls notFound for an unknown handle', async () => {
    vi.mocked(getPublicPage).mockResolvedValue(null);
    await expect(HandlePage({ params: Promise.resolve({ handle: 'nobody' }) })).rejects.toThrow();
  });
});

describe('the link to /[handle]/faq', () => {
  it('appears when the page has FAQ entries', async () => {
    vi.mocked(getPublicPage).mockResolvedValue(page);
    vi.mocked(getFaqIndex).mockResolvedValue({
      handle: 'nadia',
      displayName: 'Nadia Bakes',
      entries: [{ slug: 'berapa-harga', question: 'Berapa harga?' }],
    });

    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    expect(screen.getByRole('link', { name: /every question/i })).toHaveAttribute(
      'href',
      '/nadia/faq',
    );
  });

  // Fix round 1: the spec's top-to-bottom order (devDocs/slice-13-build-spec.md,
  // "The public page") is bento grid, ask bar, then -- on a business page with
  // entries -- the FAQ link. The brief's own sample had them reversed; the spec
  // wins. `Ask` normally renders null here (see the file-level mock), so this
  // test gives it a one-time real marker to find in the DOM.
  it('places the ask bar before the FAQ link, per the spec', async () => {
    vi.mocked(Ask).mockImplementationOnce(() => <div data-testid="ask-bar" />);
    vi.mocked(getPublicPage).mockResolvedValue(page);
    vi.mocked(getFaqIndex).mockResolvedValue({
      handle: 'nadia',
      displayName: 'Nadia Bakes',
      entries: [{ slug: 'berapa-harga', question: 'Berapa harga?' }],
    });

    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    const askBar = screen.getByTestId('ask-bar');
    const faqLink = screen.getByRole('link', { name: /every question/i });
    expect(askBar.compareDocumentPosition(faqLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // The ask bar sat straight under the grid with nothing to say what it was for.
  it('introduces the ask bar with a prompt just above it', async () => {
    vi.mocked(Ask).mockImplementationOnce(() => <div data-testid="ask-bar" />);
    vi.mocked(getPublicPage).mockResolvedValue(page);

    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    const prompt = screen.getByText('What do you want to know?');
    const askBar = screen.getByTestId('ask-bar');
    expect(prompt.compareDocumentPosition(askBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is absent when the FAQ index has no entries, so nothing links to a 404', async () => {
    vi.mocked(getPublicPage).mockResolvedValue(page);
    vi.mocked(getFaqIndex).mockResolvedValue({
      handle: 'nadia',
      displayName: 'Nadia Bakes',
      entries: [],
    });

    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    expect(screen.queryByRole('link', { name: /every question/i })).toBeNull();
  });

  it('is absent, and never queried, for a personal page', async () => {
    // Cleared rather than asserted from a fresh module, because this mock is
    // shared across the file's tests -- this checks no NEW call happened, not
    // that the mock has never been called at all.
    vi.mocked(getFaqIndex).mockClear();
    vi.mocked(getPublicPage).mockResolvedValue({ ...page, mode: 'PERSONAL' });

    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    expect(screen.queryByRole('link', { name: /every question/i })).toBeNull();
    expect(getFaqIndex).not.toHaveBeenCalled();
  });
});

describe('the capture card and the plan', () => {
  // Each case is built from the rule's own inputs, not a hand-set boolean, so
  // these prove `page.tsx` actually reads `page.paidUntil` and
  // `page.leadsCaptured` and hands the result to `Ask` -- not merely that
  // `Ask` renders something when told to. `ask.test.tsx` covers the other
  // half: that `Ask` does the right thing with whatever it receives.
  beforeEach(() => vi.mocked(Ask).mockClear());

  // Cleared above rather than reading whatever call happened last, so a page
  // that stops rendering `Ask` at all fails here instead of silently reading
  // the previous test's props. The whole point of these three is to notice a
  // gate that quietly stopped being consulted.
  function askProps() {
    expect(vi.mocked(Ask)).toHaveBeenCalledTimes(1);
    return vi.mocked(Ask).mock.calls[0]?.[0];
  }

  it('offers capture to a paid page, even with its free trial already spent', async () => {
    vi.mocked(getPublicPage).mockResolvedValueOnce({
      ...page,
      paidUntil: new Date(Date.now() + 86_400_000),
      leadsCaptured: FREE_LEADS,
    });

    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    expect(askProps()?.canCapture).toBe(true);
  });

  it('offers capture to a page inside its free trial', async () => {
    vi.mocked(getPublicPage).mockResolvedValueOnce({
      ...page,
      paidUntil: null,
      leadsCaptured: FREE_LEADS - 1,
    });

    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    expect(askProps()?.canCapture).toBe(true);
  });

  it('withholds capture from a lapsed page -- trial spent and payment expired', async () => {
    vi.mocked(getPublicPage).mockResolvedValueOnce({
      ...page,
      paidUntil: new Date(Date.now() - 86_400_000),
      leadsCaptured: FREE_LEADS,
    });

    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    expect(askProps()?.canCapture).toBe(false);
  });

  // Self-review addition: the picture test above proves BentoPage gets the
  // owner's avatar URL, but nothing proved `Ask` gets the same one -- chat
  // mode's top bar needs it too, and a page.tsx that forgot to forward it
  // would leave BentoPage's test green while chat mode showed no picture.
  it("passes the owner's picture url to Ask, computed the same way as BentoPage's", async () => {
    const original = process.env.STORAGE_PUBLIC_URL;
    process.env.STORAGE_PUBLIC_URL = 'https://cdn.example';
    try {
      vi.mocked(getPublicPage).mockResolvedValueOnce({ ...page, avatarKey: 'avatars/p/1.webp' });

      render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

      expect(askProps()?.avatarUrl).toBe('https://cdn.example/avatars/p/1.webp');
    } finally {
      if (original === undefined) delete process.env.STORAGE_PUBLIC_URL;
      else process.env.STORAGE_PUBLIC_URL = original;
    }
  });

  it('passes the display name to Ask', async () => {
    vi.mocked(getPublicPage).mockResolvedValueOnce(page);

    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    expect(askProps()?.displayName).toBe('Nadia Bakes');
  });
});

describe('indexing', () => {
  it('asks crawlers to skip a personal page', async () => {
    // FRONTEND.md has said this since slice 1 and nothing implemented it. A
    // privacy default, not an SEO setting: most people do not want an AI page
    // about themselves ranking for their own name.
    vi.mocked(getPublicPage).mockResolvedValueOnce({ ...page, mode: 'PERSONAL' });

    const { generateMetadata } = await import('./page.js');
    const meta = await generateMetadata({ params: Promise.resolve({ handle: 'nadia' }) });

    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it('leaves a business page indexable', async () => {
    vi.mocked(getPublicPage).mockResolvedValueOnce({ ...page, mode: 'BUSINESS' });

    const { generateMetadata } = await import('./page.js');
    const meta = await generateMetadata({ params: Promise.resolve({ handle: 'nadia' }) });

    expect(meta.robots).toBeUndefined();
  });

  it('lets a personal page that opted in be indexed', async () => {
    vi.mocked(getPublicPage).mockResolvedValueOnce({ ...page, mode: 'PERSONAL', allowSearchIndexing: true });
    const { generateMetadata } = await import('./page.js');

    const meta = await generateMetadata({ params: Promise.resolve({ handle: 'nadia' }) });

    expect(meta.robots).toBeUndefined();
  });
});
