import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';

const getLeads = vi.fn();
const getOwnerPage = vi.fn();
vi.mock('@curios/db-read', () => ({ getLeads, getOwnerPage }));

const resolveOwner = vi.fn();
vi.mock('../session.js', () => ({ resolveOwner }));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'a-session-value' }) }),
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

// The list closes over apiFetch and the router. These tests are about what the
// page decides to show, so the list records that it was rendered instead.
const Leads = vi.fn((_props: { leads: unknown[] }) => null);
vi.mock('./lead-list.js', () => ({ Leads }));

const LeadsPage = (await import('./page.js')).default;

const personal: OwnerPage = {
  id: 'p1',
  handle: 'nadia',
  displayName: 'Nadia',
  published: true,
  mode: 'PERSONAL',
  paidUntil: null,
  leadsCaptured: 0,
  trialResetAt: null,
  allowSearchIndexing: false,
};

describe('LeadsPage', () => {
  beforeEach(() => {
    getLeads.mockReset();
    getOwnerPage.mockReset();
    resolveOwner.mockReset();
    Leads.mockClear();
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
    getLeads.mockResolvedValue([]);
  });

  it('tells a personal page why it has no leads, and where that changes', async () => {
    getOwnerPage.mockResolvedValue(personal);

    render(await LeadsPage());

    expect(screen.getByText(/Personal pages don't collect phone numbers/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/app/billing');
    // An empty list under that sentence would read as "leads will land here".
    expect(Leads).not.toHaveBeenCalled();
  });

  it('shows a business page its leads', async () => {
    getOwnerPage.mockResolvedValue({ ...personal, mode: 'BUSINESS' });

    render(await LeadsPage());

    expect(Leads).toHaveBeenCalledTimes(1);
  });
});
