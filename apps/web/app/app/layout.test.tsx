import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';

/**
 * The frame is mounted here, so this is where "which screens exist for me" is
 * decided -- and it is not the same answer for every signed-in owner.
 *
 * An owner who has not claimed a handle has exactly one destination that
 * works. Review redirects them straight back to onboarding, and Questions
 * and Leads both scope on `page: { accountId }`, so they match nothing and
 * render "Share your link and they will land here" for a link that does not
 * exist yet. Offering those three is not a dead end, it is a lie.
 *
 * The mirror case is the one that rules out the tidier-looking fix. Moving
 * the four screens into a route group and mounting the frame there would drop
 * it from onboarding unconditionally -- but onboarding is not a one-time
 * screen. `onboarding/page.tsx` renders `<Ingest>` once a page exists, which
 * is where an owner goes to add more sources. Dropping the frame there
 * strands them on it. Both tests below have to hold at once, which is why
 * the gate is on the page and not on the route.
 */
const getOwnerPage = vi.fn();
const countNavBadges = vi.fn();
const getConversationUsage = vi.fn();
vi.mock('@curios/db-read', () => ({ getOwnerPage, countNavBadges, getConversationUsage }));

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
let pathname = '/app/curios';
vi.mock('next/navigation', () => ({ redirect, usePathname: () => pathname }));

const AppLayout = (await import('./layout.js')).default;

const page: OwnerPage = {
  id: 'p1',
  handle: 'nadia',
  displayName: 'Nadia Bakes',
  published: false,
  mode: 'BUSINESS',
  paidUntil: null,
  leadsCaptured: 0,
  ordersPlaced: 0,
  ordersAtTrialReset: 0,
  trialResetAt: null,
  storeEnabled: false,
  allowSearchIndexing: false,
  avatarKey: null,
  chipRefused: false,
};

describe('the dashboard layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConversationUsage.mockResolvedValue({ used: 0, cap: 200, period: '2026-10' });
  });

  it('hides the frame from an owner who has not claimed a handle yet', async () => {
    resolveOwner.mockResolvedValueOnce({ accountId: 'acc-1' });
    getOwnerPage.mockResolvedValueOnce(null);

    render(await AppLayout({ children: <p>Claim your handle</p> }));

    expect(screen.queryByRole('navigation', { name: 'Dashboard' })).toBeNull();
    // Not a vacuous absence: the layout did render, it just rendered without
    // the frame. Without this, deleting the whole layout would pass the line
    // above.
    expect(screen.getByText('Claim your handle')).toBeInTheDocument();
  });

  it('puts an owner with a page in the frame', async () => {
    resolveOwner.mockResolvedValueOnce({ accountId: 'acc-1' });
    getOwnerPage.mockResolvedValueOnce(page);
    countNavBadges.mockResolvedValueOnce({ review: 0, questions: 0, leads: 0, orders: 0 });

    render(await AppLayout({ children: <p>Add more sources</p> }));

    expect(screen.getByRole('navigation', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it("names the owner's plan under their name", async () => {
    resolveOwner.mockResolvedValueOnce({ accountId: 'acc-1' });
    getOwnerPage.mockResolvedValueOnce(page);
    countNavBadges.mockResolvedValueOnce({ review: 0, questions: 0, leads: 0, orders: 0 });

    render(await AppLayout({ children: <p>Add more sources</p> }));

    // A business page that has never paid and has captured nothing is on its trial.
    expect(screen.getByText('Free trial')).toBeInTheDocument();
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

  it('puts a used-up trial’s banner on Leads, and a dot on Billing', async () => {
    resolveOwner.mockResolvedValueOnce({ accountId: 'acc-1' });
    getOwnerPage.mockResolvedValueOnce({ ...page, leadsCaptured: 3 });
    countNavBadges.mockResolvedValueOnce({ review: 0, questions: 0, leads: 0, orders: 0 });

    const frame = (await AppLayout({ children: null })) as { props: { alerts: { id: string; where: string }[]; billingDot: boolean } };

    expect(frame.props.alerts).toEqual([expect.objectContaining({ id: 'spent', where: '/app/leads' })]);
    expect(frame.props.billingDot).toBe(true);
    expect(getConversationUsage).toHaveBeenCalledWith('p1', expect.any(Date));
  });

  it('counts the free orders from the trial reset, on Orders', async () => {
    resolveOwner.mockResolvedValueOnce({ accountId: 'acc-1' });
    getOwnerPage.mockResolvedValueOnce({ ...page, storeEnabled: true, ordersPlaced: 4, ordersAtTrialReset: 3 });
    countNavBadges.mockResolvedValueOnce({ review: 0, questions: 0, leads: 0, orders: 0 });

    const frame = (await AppLayout({ children: null })) as { props: { alerts: { id: string; where: string }[]; billingDot: boolean } };

    expect(frame.props.alerts).toContainEqual(expect.objectContaining({ id: 'orders-trial-1', where: '/app/orders' }));
    expect(frame.props.billingDot).toBe(false);
  });

  it('warns on Orders when the shop’s CHIP key was refused', async () => {
    resolveOwner.mockResolvedValueOnce({ accountId: 'acc-1' });
    getOwnerPage.mockResolvedValueOnce({ ...page, storeEnabled: true, ordersPlaced: 0, chipRefused: true });
    countNavBadges.mockResolvedValueOnce({ review: 0, questions: 0, leads: 0, orders: 0 });

    const frame = (await AppLayout({ children: null })) as { props: { alerts: { id: string; where: string }[]; billingDot: boolean } };

    expect(frame.props.alerts).toContainEqual(expect.objectContaining({ id: 'chip-refused', where: '/app/orders' }));
    // Not a billing matter: no dot there.
    expect(frame.props.billingDot).toBe(false);
  });

  it('puts the paused banner on Orders when the free orders are spent', async () => {
    resolveOwner.mockResolvedValueOnce({ accountId: 'acc-1' });
    getOwnerPage.mockResolvedValueOnce({ ...page, storeEnabled: true, ordersPlaced: 3 });
    countNavBadges.mockResolvedValueOnce({ review: 0, questions: 0, leads: 0, orders: 0 });

    const frame = (await AppLayout({ children: null })) as { props: { alerts: { id: string; where: string }[]; billingDot: boolean } };

    expect(frame.props.alerts).toContainEqual(expect.objectContaining({ id: 'paused', where: '/app/orders' }));
    expect(frame.props.billingDot).toBe(true);
  });

  it('leaves onboarding full screen, without the frame, once the page exists', async () => {
    pathname = '/app/onboarding';
    try {
      resolveOwner.mockResolvedValueOnce({ accountId: 'acc-1' });
      getOwnerPage.mockResolvedValueOnce(page);
      countNavBadges.mockResolvedValueOnce({ review: 0, questions: 0, leads: 0, orders: 0 });

      render(await AppLayout({ children: <p>onboarding</p> }));

      expect(screen.getByText('onboarding')).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Dashboard' })).toBeNull();
    } finally {
      pathname = '/app/curios';
    }
  });
});
