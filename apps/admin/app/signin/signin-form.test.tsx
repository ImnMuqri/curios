import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

import { SignIn } from './signin-form.js';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  });

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com');
  await userEvent.type(screen.getByLabelText(/password/i), 'a-long-enough-passphrase');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  replace.mockReset();
});

describe('SignIn', () => {
  it('is titled Curios admin', () => {
    render(<SignIn />);

    expect(screen.getByRole('heading', { name: 'Curios admin' })).toBeInTheDocument();
  });

  it('posts to /admin/signin and goes to Overview on 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(204));
    vi.stubGlobal('fetch', fetchMock);
    render(<SignIn />);

    await fillAndSubmit();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/admin\/signin$/);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@example.com', password: 'a-long-enough-passphrase' });
  });

  it('shows the API message on 401 and stays put', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json(401, { error: { code: 'ADMIN_SIGNIN_FAILED', message: 'Wrong email or password.' } })),
    );
    render(<SignIn />);

    await fillAndSubmit();

    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
