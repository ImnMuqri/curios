import { describe, expect, it, vi } from 'vitest';
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
    { id: 'l1', label: 'WhatsApp', url: 'https://wa.me/60123456789', icon: null, position: 0 },
    { id: 'l2', label: 'Instagram', url: 'https://instagram.com/nadia', icon: null, position: 1 },
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

  it('renders facts into the DOM so the page works without JavaScript', async () => {
    vi.mocked(getPublicPage).mockResolvedValue(page);
    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));
    expect(screen.getByText(/Kek 1kg butter starts at RM95/)).toBeDefined();
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
  function lastAskProps() {
    const calls = vi.mocked(Ask).mock.calls;
    return calls[calls.length - 1]?.[0];
  }

  it('offers capture to a paid page, even with its free trial already spent', async () => {
    vi.mocked(getPublicPage).mockResolvedValueOnce({
      ...page,
      paidUntil: new Date(Date.now() + 86_400_000),
      leadsCaptured: FREE_LEADS,
    });

    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    expect(lastAskProps()?.canCapture).toBe(true);
  });

  it('offers capture to a page inside its free trial', async () => {
    vi.mocked(getPublicPage).mockResolvedValueOnce({
      ...page,
      paidUntil: null,
      leadsCaptured: FREE_LEADS - 1,
    });

    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    expect(lastAskProps()?.canCapture).toBe(true);
  });

  it('withholds capture from a lapsed page -- trial spent and payment expired', async () => {
    vi.mocked(getPublicPage).mockResolvedValueOnce({
      ...page,
      paidUntil: new Date(Date.now() - 86_400_000),
      leadsCaptured: FREE_LEADS,
    });

    render(await HandlePage({ params: Promise.resolve({ handle: 'nadia' }) }));

    expect(lastAskProps()?.canCapture).toBe(false);
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
});
