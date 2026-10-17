import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AuthLink } from '@curios/db-read';

let link: AuthLink = { state: 'unknown' };
vi.mock('@curios/db-read', () => ({ getAuthLink: vi.fn(async () => link) }));

const { default: VerifyPage } = await import('./page.js');
const { default: ResetPage } = await import('../reset/page.js');

const at = async (Page: typeof VerifyPage, token?: string) =>
  render(await Page({ searchParams: Promise.resolve(token ? { token } : {}) }));

const known = (state: 'usable' | 'expired' | 'used', verified = false): AuthLink => ({
  state,
  email: 'lina@keklina.example',
  name: 'Lina',
  verified,
});

describe('the verify page picks a screen from where the link stands', () => {
  beforeEach(() => {
    link = { state: 'unknown' };
  });

  it('a link cut short, or never ours, does not work', async () => {
    await at(VerifyPage);
    expect(screen.getByRole('heading', { name: 'That link doesn’t work' })).toBeInTheDocument();
  });

  it('an address already confirmed says so, whichever link it was', async () => {
    link = known('used', true);
    await at(VerifyPage, 'tok');
    expect(screen.getByRole('heading', { name: 'Your email is confirmed' })).toBeInTheDocument();
  });

  it('an old or replaced link offers a fresh one', async () => {
    link = known('expired');
    await at(VerifyPage, 'tok');
    expect(screen.getByRole('heading', { name: 'This link has expired' })).toBeInTheDocument();
  });
});

describe('the reset page', () => {
  it('sends a used or old link to the broken-link screen', async () => {
    link = known('expired');
    await at(ResetPage, 'tok');
    expect(screen.getByRole('heading', { name: 'That link doesn’t work' })).toBeInTheDocument();
  });

  it('names the address of a good one', async () => {
    link = known('usable');
    await at(ResetPage, 'tok');
    expect(screen.getByText('For lina@keklina.example. You’ll stay signed in on this device.')).toBeInTheDocument();
  });
});
