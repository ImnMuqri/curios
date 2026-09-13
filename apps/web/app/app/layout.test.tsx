import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';

/**
 * The nav is mounted here, so this is where "which screens exist for me" is
 * decided -- and it is not the same answer for every signed-in owner.
 *
 * An owner who has not claimed a handle has exactly one destination that
 * works. Review redirects them straight back to onboarding, and Questions
 * and Leads both scope on `page: { accountId }`, so they match nothing and
 * render "Share your link and they will land here" for a link that does not
 * exist yet. Offering those three is not a dead end, it is a lie.
 *
 * The mirror case is the one that rules out the tidier-looking fix. Moving
 * the four screens into a route group and mounting the nav there would drop
 * it from onboarding unconditionally -- but onboarding is not a one-time
 * screen. `onboarding/page.tsx` renders `<Ingest>` once a page exists, which
 * is where an owner goes to add more sources. Dropping the nav there strands
 * them on it. Both tests below have to hold at once, which is why the gate
 * is on the page and not on the route.
 */
const getOwnerPage = vi.fn();
vi.mock('@curios/db-read', () => ({ getOwnerPage }));

const resolveOwner = vi.fn();
vi.mock('./session.js', () => ({ resolveOwner }));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'a-session-value' }) }),
}));

// Throws, because the real `redirect` throws NEXT_REDIRECT. Same reasoning as
// review/page.test.tsx: a mock that merely records lets control fall through
// a redirect the code must not survive.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect, usePathname: () => '/app/onboarding' }));

const AppLayout = (await import('./layout.js')).default;

const page: OwnerPage = {
  id: 'p1',
  handle: 'nadia',
  displayName: 'Nadia Bakes',
  published: false,
  mode: 'BUSINESS',
  paidUntil: null,
  leadsCaptured: 0,
};

describe('the dashboard layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides the nav from an owner who has not claimed a handle yet', async () => {
    resolveOwner.mockResolvedValueOnce({ accountId: 'acc-1' });
    getOwnerPage.mockResolvedValueOnce(null);

    render(await AppLayout({ children: <p>Claim your handle</p> }));

    expect(screen.queryByRole('navigation')).toBeNull();
    // Not a vacuous absence: the layout did render, it just rendered without
    // the nav. Without this, deleting the whole layout would pass the line
    // above.
    expect(screen.getByText('Claim your handle')).toBeInTheDocument();
  });

  it('keeps the nav for an owner revisiting onboarding to add sources', async () => {
    resolveOwner.mockResolvedValueOnce({ accountId: 'acc-1' });
    getOwnerPage.mockResolvedValueOnce(page);

    render(await AppLayout({ children: <p>Add more sources</p> }));

    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });

  it('refuses a session the database does not recognise, before asking for a page', async () => {
    resolveOwner.mockResolvedValueOnce(null);

    await expect(AppLayout({ children: <p>never rendered</p> })).rejects.toThrow(
      'NEXT_REDIRECT:/signin',
    );
    // Ordering, not just the redirect: proving who you are comes before
    // querying anything on their behalf.
    expect(getOwnerPage).not.toHaveBeenCalled();
  });
});
