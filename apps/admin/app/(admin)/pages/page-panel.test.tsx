import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminPageDetail } from '@curios/db-read/admin';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../../../lib/api.js', () => ({ apiFetch: vi.fn(), ApiError: class extends Error {} }));

import { PagePanel } from './page-panel.js';

function detail(over: Partial<AdminPageDetail> = {}): AdminPageDetail {
  return {
    id: 'p1',
    handle: 'keklina',
    displayName: 'Kek Lina',
    mode: 'BUSINESS',
    status: 'Live',
    ownerEmail: 'lina@keklina.example',
    createdAt: new Date('2026-09-02T03:00:00Z'),
    signInMethods: ['google'],
    plan: 'Business',
    paidUntil: new Date('2026-11-14T03:00:00Z'),
    conversationsThisMonth: 164,
    cap: 200,
    factCount: 12,
    suspendedAt: null,
    suspendReason: null,
    grantedMonths: 0,
    ...over,
  };
}

const props = { appUrl: 'http://localhost:3000', listHref: '/pages', onToast: () => {} };

describe('PagePanel', () => {
  it('shows the board fields', () => {
    render(<PagePanel page={detail()} {...props} />);

    expect(screen.getByRole('heading', { name: 'Kek Lina' })).toBeInTheDocument();
    for (const text of [
      'lina@keklina.example',
      'Google',
      'Business',
      '14 Nov 2026',
      '2 Sep 2026',
      'Live',
      '164 of 200',
      '12',
    ]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
  });

  it('opens the page in a new tab from APP_URL', () => {
    render(<PagePanel page={detail()} {...props} />);

    const open = screen.getByRole('link', { name: /Open page/ });
    expect(open).toHaveAttribute('href', 'http://localhost:3000/keklina');
    expect(open).toHaveAttribute('target', '_blank');
  });

  it('offers every action', () => {
    render(<PagePanel page={detail()} {...props} />);

    for (const name of [
      /^See it as the owner/,
      /^Give one month of Business/,
      /^Reset this month.s conversations/,
      /^Suspend page/,
      /^Delete account/,
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('flips to Bring the page back for a suspended page', async () => {
    render(
      <PagePanel
        page={detail({ status: 'Suspended', suspendedAt: new Date('2026-10-20T03:00:00Z'), suspendReason: 'Scam' })}
        {...props}
      />,
    );

    expect(screen.queryByRole('button', { name: /^Suspend page/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Bring the page back/ }));
    expect(screen.getByRole('dialog', { name: 'Bring curios.my/keklina back?' })).toBeInTheDocument();
    expect(screen.getByText('20 Oct 2026: Scam')).toBeInTheDocument();
  });
});
