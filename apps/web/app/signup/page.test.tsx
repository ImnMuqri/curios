import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { defaultSettings } from '@curios/core/settings';

const getSettings = vi.fn();
vi.mock('@curios/db-read', () => ({ getSettings }));

const SignUpPage = (await import('./page.js')).default;

const settings = (signups: boolean) => {
  const s = defaultSettings();
  s.switches.signups = signups;
  return s;
};

async function renderWith(signups: boolean, closed?: string) {
  getSettings.mockResolvedValueOnce(settings(signups));
  render(await SignUpPage({ searchParams: Promise.resolve({ closed }) }));
}

describe('/signup', () => {
  beforeEach(() => getSettings.mockReset());

  it('says Curios is full in place of the form while sign-ups are closed, and still offers sign in', async () => {
    await renderWith(false);
    expect(screen.getByText('Curios is full for now. Try again soon.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Continue with Google' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/signin');
  });

  it('shows the form on ?closed=1 once sign-ups are open again: only the switch decides', async () => {
    await renderWith(true, '1');
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByText('Curios is full for now. Try again soon.')).toBeNull();
  });

  it('shows the form while sign-ups are open', async () => {
    await renderWith(true);
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.queryByText('Curios is full for now. Try again soon.')).toBeNull();
  });
});
