import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';

const getLeads = vi.fn();
const getOwnerPage = vi.fn();
const getLeadStats = vi.fn();
const getMyCurios = vi.fn();
vi.mock('@curios/db-read', () => ({ getLeads, getOwnerPage, getLeadStats, getMyCurios }));

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
const Leads = vi.fn((_props: Record<string, unknown>) => null);
vi.mock('./leads-screen.js', () => ({ Leads }));

const LeadsPage = (await import('./page.js')).default;

const personal: OwnerPage = {
  id: 'p1',
  handle: 'nadia',
  displayName: 'Nadia',
  published: true,
  mode: 'PERSONAL',
  paidUntil: null,
  leadsCaptured: 0,
  ordersPlaced: 0,
  ordersAtTrialReset: 0,
  trialResetAt: null,
  storeEnabled: false,
  allowSearchIndexing: false,
  avatarKey: null,
  chipRefused: false,
  payByQr: true,
};

describe('LeadsPage', () => {
  beforeEach(() => {
    getLeads.mockReset();
    getOwnerPage.mockReset();
    resolveOwner.mockReset();
    Leads.mockClear();
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
    getLeads.mockResolvedValue([]);
    getLeadStats.mockClear();
    getLeadStats.mockResolvedValue({ waiting: 1, week: [0, 0, 0, 0, 0, 0, 1], sold: 0 });
    getMyCurios.mockResolvedValue({ language: 'ms', accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null });
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

  it('hands over the figures, the page, and one moment for the whole screen', async () => {
    getOwnerPage.mockResolvedValue({ ...personal, mode: 'BUSINESS', paidUntil: new Date('2099-01-01') });

    render(await LeadsPage());

    const props = Leads.mock.calls[0]![0];
    const now = getLeadStats.mock.calls[0]![1] as Date;
    expect(props).toMatchObject({
      stats: { waiting: 1, week: [0, 0, 0, 0, 0, 0, 1], sold: 0 },
      handle: 'nadia',
      displayName: 'Nadia',
      language: 'ms',
      now: now.toISOString(),
      look: { accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null },
    });
  });

  // Fix round 2, Important #3: AppFrame renders its own main around every
  // screen it wraps, this one included, so a second one here would nest.
  it('renders no main of its own', async () => {
    getOwnerPage.mockResolvedValue(personal);

    render(await LeadsPage());

    expect(screen.queryByRole('main')).toBeNull();
  });
});
