import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let pathname = '/kekklina';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
const apiFetch = vi.fn(async (_path: string): Promise<{ handle: string | null }> => ({ handle: null }));
vi.mock('../../lib/api.js', () => ({ apiFetch }));

const { NotFoundScreen } = await import('./NotFoundScreen.js');
const { default: ErrorScreen } = await import('../error.js');

describe('NotFoundScreen', () => {
  it('strikes out an address that could be a page, and offers to claim it', async () => {
    pathname = '/kekklina';
    render(<NotFoundScreen />);

    expect(screen.getByRole('heading', { name: 'Nobody lives here yet.' })).toBeInTheDocument();
    expect(screen.getByText('404 · not found')).toBeInTheDocument();
    expect(screen.getByText('kekklina').tagName).toBe('B');
    const claim = screen.getByRole('link', { name: 'Claim curios.my/kekklina' });
    expect(claim).toHaveAttribute('href', '/signup');

    claim.addEventListener('click', (event) => event.preventDefault());
    await userEvent.click(claim);
    // Carried to sign-up the way the landing page's claim field carries it.
    expect(window.localStorage.getItem('curios:wanted-handle')).toBe('kekklina');
  });

  it('draws the tinted panel: a giant 404, the tilted sign with the address, and Peek, sad', () => {
    pathname = '/kekklina';
    const { container } = render(<NotFoundScreen />);
    const panel = container.querySelector('[class*="big"]') as HTMLElement;
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    expect(within(panel).getByText('404')).toBeInTheDocument();
    expect(within(panel).getByText('curios.my/kekklina')).toBeInTheDocument();
    expect(panel.querySelector('svg')?.getAttribute('class')).toMatch(/sad/);
    // The old ghost phone card is gone.
    expect(container.querySelector('[class*="ghostcard"]')).toBeNull();
  });

  it('asks which page was meant, and offers it in the board’s words', async () => {
    pathname = '/kekklina';
    apiFetch.mockResolvedValueOnce({ handle: 'keklina' });
    render(<NotFoundScreen />);

    expect(apiFetch).toHaveBeenLastCalledWith('/pages/near?handle=kekklina');
    expect(await screen.findByText(/Looking for someone\? Did you mean/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'curios.my/keklina' })).toHaveAttribute('href', '/keklina');
  });

  it('offers nothing to claim at an address that was never a page’s', () => {
    pathname = '/app/nothing-here';
    apiFetch.mockClear();
    render(<NotFoundScreen />);
    expect(apiFetch).not.toHaveBeenCalled();

    expect(screen.queryByRole('link', { name: /Claim/ })).toBeNull();
    expect(screen.queryByText(/^curios\.my\/$/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Curios' })).toHaveAttribute('href', '/');
  });
});

describe('ErrorScreen', () => {
  it('owns the fault, retries, and gives the ref to quote', async () => {
    const reset = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorScreen error={Object.assign(new Error('boom'), { digest: '7F3K21Q' })} reset={reset} />);

    expect(screen.getByRole('heading', { name: 'Something broke on our side' })).toBeInTheDocument();
    // The board leaves the reference out; support needs it, so it stays as one small muted line (DEVIATIONS 386).
    expect(screen.getByText('Error ref 7F3K21Q').className).toMatch(/ref/);
    expect(screen.getByRole('link', { name: 'Go to Curios' })).toHaveAttribute('href', '/');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Trying…' })).toBeDisabled();
  });
});

describe('SystemShell, without the template look', () => {
  it('is flat paper: no gradient blobs and no grain', () => {
    pathname = '/kekklina';
    const { container } = render(<NotFoundScreen />);
    expect(container.querySelector('[class*="blob"]')).toBeNull();
    expect(container.querySelector('[class*="grain"]')).toBeNull();
    expect(container.querySelector('filter')).toBeNull();
  });
});

describe('BadLink', () => {
  it('says what to ask for next, by which email the link came from', async () => {
    const { BadLink } = await import('./BadLink.js');
    const { unmount } = render(<BadLink />);
    expect(screen.getByRole('heading', { name: 'That link doesn’t work' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send me a new link' })).toHaveAttribute('href', '/forgot');
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/signin');
    unmount();

    render(<BadLink kind="verify" detail="Too many tries." />);
    expect(screen.queryByRole('link', { name: 'Send me a new link' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Too many tries.');
  });
});

describe('UnavailableScreen', () => {
  it('gives a way out, in the page’s language', async () => {
    const { UnavailableScreen } = await import('./unavailable.js');
    const { unmount } = render(<UnavailableScreen language="en" />);
    expect(screen.getByRole('heading', { name: 'This page is unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Curios' })).toHaveAttribute('href', '/');
    unmount();

    render(<UnavailableScreen language="ms" />);
    expect(screen.getByRole('link', { name: 'Pergi ke Curios' })).toHaveAttribute('href', '/');
  });
});

describe('the system screens wear the landing nav, with Peek and a badge', () => {
  it('shows the sections, sign in and the call to action, and Peek in a mood with a round badge', async () => {
    const { VerifyingArt, ExpiredArt, DoneArt, UnpluggedArt } = await import('./art.js');
    const { SystemShell, SystemCard } = await import('./SystemShell.js');
    const { container } = render(
      <SystemShell>
        <SystemCard art={<ExpiredArt />} title="This link has expired" />
      </SystemShell>,
    );
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Make your page' })).toHaveAttribute('href', '/signup');
    expect(container.querySelector('[data-mood="sad"]')).not.toBeNull();
    expect(container.querySelector('[class*="badge"]')).not.toBeNull();

    const { container: done } = render(<DoneArt />);
    expect(done.querySelector('[data-mood="happy"] [class*="badge"][class*="ok"]')).not.toBeNull();
    const { container: wait } = render(<VerifyingArt />);
    expect(wait.querySelector('[class*="wait"]')).not.toBeNull();
    expect(wait.querySelector('[class*="badge"]')).toBeNull();
    const { container: plug } = render(<UnpluggedArt />);
    expect(plug.querySelector('[data-mood="sad"] [class*="badge"] svg')).not.toBeNull();
  });
});
