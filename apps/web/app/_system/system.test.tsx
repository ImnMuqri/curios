import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    expect(screen.getByText('kekklina').tagName).toBe('B');
    const claim = screen.getByRole('link', { name: 'Claim curios.my/kekklina' });
    expect(claim).toHaveAttribute('href', '/signup');

    claim.addEventListener('click', (event) => event.preventDefault());
    await userEvent.click(claim);
    // Carried to sign-up the way the landing page's claim field carries it.
    expect(window.localStorage.getItem('curios:wanted-handle')).toBe('kekklina');
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
    expect(screen.getByRole('link', { name: 'Go to Curios' })).toHaveAttribute('href', '/');
  });
});

describe('ErrorScreen', () => {
  it('owns the fault, retries, and gives the ref to quote', async () => {
    const reset = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorScreen error={Object.assign(new Error('boom'), { digest: '7F3K21Q' })} reset={reset} />);

    expect(screen.getByRole('heading', { name: 'Something broke on our side' })).toBeInTheDocument();
    expect(screen.getByText('Error ref 7F3K21Q')).toBeInTheDocument();
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
