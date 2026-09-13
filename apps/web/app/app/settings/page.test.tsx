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
vi.mock('@curios/db-read', () => ({ getSignInMethods }));

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

const SettingsPage = (await import('./page.js')).default;

const methods = (overrides: Partial<SignInMethods>): SignInMethods => ({
  email: 'nadia@example.com',
  hasPassword: true,
  providers: [],
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
  });

  it('after linking, says Google is connected and offers neither form', async () => {
    // The real end state of the walkthrough's path 1: the owner had a password,
    // has just connected Google, and lands back here with ?linked=google. So
    // the banner, the both-methods sentence and the missing link all hold at
    // once, from one render.
    await renderWith({ linked: 'google' }, methods({ providers: ['GOOGLE'] }));

    expect(screen.getByText('Google is now connected to your account.')).toBeInTheDocument();
    expect(
      screen.getByText('You can already sign in with your password or with Google.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Connect Google' })).not.toBeInTheDocument();
  });

  it('before linking, offers the Connect Google link and says nothing about it', async () => {
    // The other half. Without it, the missing link above would pass just as
    // well against a page that never rendered the link for anyone.
    await renderWith({}, methods({ providers: [] }));

    expect(screen.getByRole('link', { name: 'Connect Google' })).toBeInTheDocument();
    expect(screen.queryByText('Google is now connected to your account.')).not.toBeInTheDocument();
    expect(
      screen.queryByText('You can already sign in with your password or with Google.'),
    ).not.toBeInTheDocument();
  });

  it('paints the session-ended message when a link attempt outlived its session', async () => {
    // Compared against the shared table rather than re-typed. The walkthrough
    // quotes this sentence, and a quoted copy is exactly what drifts.
    await renderWith({ error: 'unauthenticated' }, methods({ providers: [] }));

    expect(screen.getByRole('alert')).toHaveTextContent(oauthErrorMessage('unauthenticated'));
  });
});
