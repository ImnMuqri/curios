import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerPage, ReviewFact } from '@curios/db-read';

/**
 * The one test that guards F5 where F5 is actually decided.
 *
 * `PublishButton` takes no prop about facts or verification, so the obvious
 * gate -- `disabled={!somethingVerified}` -- cannot be added without first
 * adding a prop, which is a visible diff to a file that has tests. But that
 * is not where the guarantee lives. What actually keeps the button visible
 * while facts remain is this page rendering `<Publish>` as an UNCONDITIONAL
 * sibling of `<Review>`. Wrapping it in `{facts.length === 0 && ...}` -- the
 * exact temptation B3 names -- reintroduces the gate F5 forbids, touches no
 * tested file, and passes every other test in the suite.
 *
 * A Next 15 async Server Component is just an async function returning JSX,
 * so it can be awaited and rendered. `app/[handle]/page.test.tsx` already
 * does this; the plan's self-review claim that nothing here renders a Server
 * Component was out of date.
 */
const getOwnerPage = vi.fn();
const getReviewQueue = vi.fn();
vi.mock('@curios/db-read', () => ({ getOwnerPage, getReviewQueue }));

const resolveOwner = vi.fn();
vi.mock('../session.js', () => ({ resolveOwner }));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'a-session-value' }) }),
}));

// Throws, because the real `redirect` throws NEXT_REDIRECT. A mock that
// merely records the call lets control fall through and the component runs
// on past a redirect it should not survive -- which would make the last test
// below assert the opposite of the truth.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect, useRouter: () => ({ refresh: vi.fn() }) }));

const ReviewPage = (await import('./page.js')).default;

const page: OwnerPage = {
  id: 'p1',
  handle: 'nadia',
  displayName: 'Nadia Bakes',
  published: false,
};

const unreviewed: ReviewFact[] = [
  {
    id: 'f1',
    category: 'PRICE',
    claim: 'Kuih lapis is RM12 a box',
    sourceText: 'RM12 per box.',
    sourceUrl: null,
    confidence: 0.9,
  },
];

describe('the review screen, assembled', () => {
  // Cleared per test, not shared: the last test asserts `getReviewQueue` was
  // NOT called, which is only meaningful against a fresh spy. `mockClear`
  // keeps `redirect`'s throwing implementation.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers Publish while facts are still waiting to be reviewed', async () => {
    // F5, at the composition level. Publishing is a deliberate owner action
    // and nothing more: the API has no gate, and a page with only links is a
    // valid page. An owner who wants to publish before reviewing anything is
    // allowed to, and this is the test that says so.
    resolveOwner.mockResolvedValueOnce({ accountId: 'acc-1' });
    getOwnerPage.mockResolvedValueOnce(page);
    getReviewQueue.mockResolvedValueOnce(unreviewed);

    render(await ReviewPage());

    expect(screen.getByRole('button', { name: /^publish$/i })).toBeInTheDocument();
    // And the queue is genuinely non-empty, so this is not passing because
    // the empty state happened to render.
    expect(screen.getByText(/kuih lapis is rm12 a box/i)).toBeInTheDocument();
  });

  it('offers Publish when there is nothing left to review', async () => {
    resolveOwner.mockResolvedValueOnce({ accountId: 'acc-1' });
    getOwnerPage.mockResolvedValueOnce(page);
    getReviewQueue.mockResolvedValueOnce([]);

    render(await ReviewPage());

    expect(screen.getByRole('button', { name: /^publish$/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing left to review/i)).toBeInTheDocument();
  });

  it('shows the live URL instead of the button once published', async () => {
    // B1: publishing is a one-time switch. Both public read paths filter
    // `verified: true` at read time, so a fact accepted after publishing is
    // public immediately and there is no second publish to offer.
    resolveOwner.mockResolvedValueOnce({ accountId: 'acc-1' });
    getOwnerPage.mockResolvedValueOnce({ ...page, published: true });
    getReviewQueue.mockResolvedValueOnce(unreviewed);

    render(await ReviewPage());

    expect(screen.queryByRole('button', { name: /^publish$/i })).toBeNull();
    expect(screen.getByRole('link', { name: /nadia/i }).getAttribute('href')).toMatch(/\/nadia$/);
  });

  it('sends an owner with no page back to claim one', async () => {
    // Which is why the NO_PAGE branch in `PublishButton` is a race and not a
    // path -- this screen cannot render without a page (B4).
    resolveOwner.mockResolvedValueOnce({ accountId: 'acc-1' });
    getOwnerPage.mockResolvedValueOnce(null);

    await expect(ReviewPage()).rejects.toThrow('NEXT_REDIRECT:/app/onboarding');
    // Not merely that it redirected -- that it stopped. A redirect the code
    // runs past is not a redirect.
    expect(getReviewQueue).not.toHaveBeenCalled();
  });
});
