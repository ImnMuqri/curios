import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SignInMethods } from '@curios/db-read';
import { oauthErrorMessage } from '../../../lib/oauth-errors.js';

/**
 * The settings page as rendered, not its decisions in isolation.
 *
 * `settings.test.ts` already proves `decideSettingsView` and
 * `decideSettingsBanner` return the right flags. What nothing proved is that
 * `page.tsx` turns those flags into the words and the link the Google-link
 * walkthrough tells a human to look for -- so a copy change, or a flag wired to
 * the wrong element, stayed green while the walkthrough quietly went wrong.
 * The decisions run for real here; only the edges of the page are stubbed.
 */
const getSignInMethods = vi.fn();
const getOwnerPage = vi.fn();
const getNotifications = vi.fn();
vi.mock('@curios/db-read', () => ({ getSignInMethods, getOwnerPage, getNotifications }));

const resolveOwner = vi.fn();
vi.mock('../session.js', () => ({ resolveOwner }));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'a-session-value' }) }),
}));

// Throws, because the real `redirect` throws NEXT_REDIRECT. A mock that merely
// recorded the call would let control fall through a redirect the page must
// not survive -- the same reasoning as layout.test.tsx.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

// `AddPassword` closes over `apiFetch`. None of these checks is about the
// password form, so it is stubbed rather than dragged into a render test about
// Google. `ConnectGoogle` is a plain anchor with no state and stays real: the
// walkthrough's "the Connect Google link disappears" is a claim about that
// actual link.
vi.mock('./add-password-form.js', () => ({ AddPassword: () => null }));

const SearchIndexing = vi.fn((_props: { mode: string; allowed: boolean }) => null);
vi.mock('./search-indexing.js', () => ({ SearchIndexing }));

const SettingsPage = (await import('./page.js')).default;

const methods = (overrides: Partial<SignInMethods>): SignInMethods => ({
  email: 'nadia@example.com',
  hasPassword: true,
  providers: [],
  googleEmail: null,
  ...overrides,
});

async function renderWith(params: { linked?: string; error?: string }, signIn: SignInMethods) {
  getSignInMethods.mockResolvedValueOnce(signIn);
  render(await SettingsPage({ searchParams: Promise.resolve(params) }));
}

describe('SettingsPage', () => {
  beforeEach(() => {
    resolveOwner.mockReset();
    getSignInMethods.mockReset();
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
    getOwnerPage.mockReset();
    getOwnerPage.mockResolvedValue(null);
    getNotifications.mockResolvedValue({ leads: true });
    SearchIndexing.mockClear();
  });

  it('after linking, says Google is connected and offers neither form', async () => {
    // The real end state of the walkthrough's path 1: the owner had a password,
    // has just connected Google, and lands back here with ?linked=google. So
    // the banner, the both-methods sentence and the missing link all hold at
    // once, from one render.
    await renderWith({ linked: 'google' }, methods({ providers: ['GOOGLE'], googleEmail: 'nadia.bakes@gmail.example' }));

    expect(screen.getByText('Google is now connected to your account.')).toBeInTheDocument();
    expect(screen.getByText('You can sign in with your password or with Google.')).toBeInTheDocument();
    expect(screen.getByText('nadia.bakes@gmail.example')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Connect Google' })).not.toBeInTheDocument();
  });

  it('before linking, offers the Connect Google link and says nothing about it', async () => {
    // The other half. Without it, the missing link above would pass just as
    // well against a page that never rendered the link for anyone.
    await renderWith({}, methods({ providers: [] }));

    expect(screen.getByRole('link', { name: 'Connect Google' })).toBeInTheDocument();
    expect(screen.queryByText('Google is now connected to your account.')).not.toBeInTheDocument();
    expect(screen.getByText('Add a second way in, for the day the first one fails you.')).toBeInTheDocument();
    expect(screen.getByText('Not connected.')).toBeInTheDocument();
  });

  it('paints the session-ended message when a link attempt outlived its session', async () => {
    // Compared against the shared table rather than re-typed. The walkthrough
    // quotes this sentence, and a quoted copy is exactly what drifts.
    await renderWith({ error: 'unauthenticated' }, methods({ providers: [] }));

    expect(screen.getByRole('alert')).toHaveTextContent(oauthErrorMessage('unauthenticated'));
  });

  it('offers a personal page its search switch, set as the page has it', async () => {
    getOwnerPage.mockResolvedValue({
      id: 'p1',
      handle: 'nadia',
      displayName: 'Nadia',
      published: true,
      mode: 'PERSONAL',
      paidUntil: null,
      leadsCaptured: 0,
      trialResetAt: null,
      allowSearchIndexing: false,
    });

    await renderWith({}, methods({}));

    expect(SearchIndexing.mock.calls[0]?.[0]).toEqual({ mode: 'PERSONAL', allowed: false });
  });

  it('shows the page’s address to copy, and what kind of page it is', async () => {
    getOwnerPage.mockResolvedValue({
      id: 'p1',
      handle: 'nadia',
      displayName: 'Nadia',
      published: true,
      mode: 'BUSINESS',
      paidUntil: null,
      leadsCaptured: 0,
      trialResetAt: null,
      allowSearchIndexing: false,
    });

    await renderWith({}, methods({}));

    expect(screen.getByText(/\/nadia$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.getByText(/can't be switched back to personal/)).toBeInTheDocument();
  });

  it('points a personal page at Business, where the switch is', async () => {
    getOwnerPage.mockResolvedValue({
      id: 'p1',
      handle: 'nadia',
      displayName: 'Nadia',
      published: true,
      mode: 'PERSONAL',
      paidUntil: null,
      leadsCaptured: 0,
      trialResetAt: null,
      allowSearchIndexing: false,
    });

    await renderWith({}, methods({}));

    expect(screen.getByRole('link', { name: 'See Business' })).toHaveAttribute('href', '/app/billing');
  });

  it('says how to change a password that is already set', async () => {
    await renderWith({}, methods({ hasPassword: true }));

    expect(screen.getByText(/forgot your password\?/i)).toBeInTheDocument();
  });

  it('lets the owner sign out', async () => {
    await renderWith({}, methods({}));

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('offers a business page the lead email switch, set as it is', async () => {
    getOwnerPage.mockResolvedValue({
      id: 'p1', handle: 'nadia', displayName: 'Nadia', published: true, mode: 'BUSINESS',
      paidUntil: null, leadsCaptured: 0, trialResetAt: null, allowSearchIndexing: false,
    });
    getNotifications.mockResolvedValue({ leads: false });

    await renderWith({}, methods({}));

    expect(screen.getByRole('heading', { name: 'Email me when' })).toBeInTheDocument();
    expect(screen.getByText('Sent to nadia@example.com. Everything also shows in the app.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Email me when someone leaves their number' })).toHaveAttribute('aria-checked', 'false');
  });

  it('offers a personal page no email switches, since it takes no leads', async () => {
    getOwnerPage.mockResolvedValue({
      id: 'p1', handle: 'nadia', displayName: 'Nadia', published: true, mode: 'PERSONAL',
      paidUntil: null, leadsCaptured: 0, trialResetAt: null, allowSearchIndexing: false,
    });

    await renderWith({}, methods({}));

    expect(screen.queryByRole('heading', { name: 'Email me when' })).toBeNull();
  });
});
