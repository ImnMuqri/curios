import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OwnerPage } from '@curios/db-read';

const getLeadsPage = vi.fn();
const getOwnerPage = vi.fn();
const getLeadStats = vi.fn();
const getMyCurios = vi.fn();
vi.mock('@curios/db-read', () => ({ getLeadsPage, getOwnerPage, getLeadStats, getMyCurios }));

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
  suspendedAt: null,
  suspendReason: null,
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
    getLeadsPage.mockReset();
    getOwnerPage.mockReset();
    resolveOwner.mockReset();
    Leads.mockClear();
    resolveOwner.mockResolvedValue({ accountId: 'acc1' });
    getLeadsPage.mockResolvedValue({ leads: [], older: null });
    getLeadStats.mockClear();
    getLeadStats.mockResolvedValue({ waiting: 1, thisWeek: 1, sold: 0 });
    getMyCurios.mockResolvedValue({ language: 'ms', accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null });
  });

  it('tells a personal page why it has no leads, and where that changes', async () => {
    getOwnerPage.mockResolvedValue(personal);

    render(await LeadsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(/Personal pages don't collect phone numbers/)).toBeInTheDocument();
    // The same head as the business screen's.
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByText('People your page couldn’t answer, with what they asked.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/app/billing');
    // An empty list under that sentence would read as "leads will land here".
    expect(Leads).not.toHaveBeenCalled();
    // And nothing is read for a list that cannot exist.
    expect(getLeadsPage).not.toHaveBeenCalled();
    expect(getLeadStats).not.toHaveBeenCalled();
  });

  it('shows a business page its leads', async () => {
    getOwnerPage.mockResolvedValue({ ...personal, mode: 'BUSINESS' });

    render(await LeadsPage({ searchParams: Promise.resolve({}) }));

    expect(Leads).toHaveBeenCalledTimes(1);
  });

  it('hands over the figures, the page, and one moment for the whole screen', async () => {
    getOwnerPage.mockResolvedValue({ ...personal, mode: 'BUSINESS', paidUntil: new Date('2099-01-01') });

    render(await LeadsPage({ searchParams: Promise.resolve({}) }));

    const props = Leads.mock.calls[0]![0];
    const now = getLeadStats.mock.calls[0]![1] as Date;
    expect(props).toMatchObject({
      stats: { waiting: 1, thisWeek: 1, sold: 0 },
      displayName: 'Nadia',
      publicUrl: expect.stringMatching(/\/nadia$/),
      language: 'ms',
      now: now.toISOString(),
    });
    // The conversation is the dashboard's neutral chat now: the page's colours are not handed over.
    expect(props).not.toHaveProperty('look');
  });

  it('hands over what the page read, with every NEW lead on the first page, and the cursor for older ones', async () => {
    getOwnerPage.mockResolvedValue({ ...personal, mode: 'BUSINESS' });
    // Fifty-two: two NEW ones kept on the page (the read keeps them there) and fifty others.
    const many = Array.from({ length: 52 }, (_, i) => ({ id: `l${i}` }));
    getLeadsPage.mockResolvedValue({ leads: many, older: 'l49' });

    render(await LeadsPage({ searchParams: Promise.resolve({}) }));

    expect(getLeadsPage).toHaveBeenCalledWith('acc1', { perPage: 50, before: undefined });
    const props = Leads.mock.calls[0]![0] as { leads: unknown[]; paging: unknown };
    expect(props.leads).toHaveLength(52);
    expect(props.paging).toEqual({ older: 'l49', paged: false });
  });

  it("hands an enquiry's item photo over as a URL, and a chat lead none", async () => {
    vi.stubEnv('STORAGE_PUBLIC_URL', 'https://files.example/');
    getOwnerPage.mockResolvedValue({ ...personal, mode: 'BUSINESS' });
    getLeadsPage.mockResolvedValue({ older: null, leads: [
      { id: 'e1', enquiry: { name: 'Farah', note: 'Frozen theme.', item: { name: 'Custom birthday cake', photoKey: 'items/cake.webp', fromCents: 18000 } } },
      { id: 'e2', enquiry: { name: 'Aina', note: null, item: null } },
      { id: 'l1', enquiry: null },
    ] });

    render(await LeadsPage({ searchParams: Promise.resolve({}) }));

    const shown = (Leads.mock.calls[0]![0] as { leads: { id: string; itemPhotoUrl: string | null; enquiry: unknown }[] }).leads;
    expect(shown.map((lead) => lead.itemPhotoUrl)).toEqual(['https://files.example/items/cake.webp', null, null]);
    expect(shown[0]!.enquiry).toMatchObject({ name: 'Farah', item: { photoKey: 'items/cake.webp' } });
    vi.unstubAllEnvs();
  });

  it('reads the next page from ?before, and offers no older link at the end', async () => {
    getOwnerPage.mockResolvedValue({ ...personal, mode: 'BUSINESS' });
    getLeadsPage.mockResolvedValue({ leads: [{ id: 'l60' }], older: null });

    render(await LeadsPage({ searchParams: Promise.resolve({ before: 'l49' }) }));

    expect(getLeadsPage).toHaveBeenCalledWith('acc1', { perPage: 50, before: 'l49' });
    expect((Leads.mock.calls[0]![0] as { paging: unknown }).paging).toEqual({ older: null, paged: true });
  });

  it('sends a cursor that pages nothing back to the newest leads', async () => {
    getOwnerPage.mockResolvedValue({ ...personal, mode: 'BUSINESS' });
    getLeadsPage.mockResolvedValue(null);

    await expect(LeadsPage({ searchParams: Promise.resolve({ before: 'gone' }) })).rejects.toThrow('NEXT_REDIRECT:/app/leads');
  });

  // Fix round 2, Important #3: AppFrame renders its own main around every
  // screen it wraps, this one included, so a second one here would nest.
  it('renders no main of its own', async () => {
    getOwnerPage.mockResolvedValue(personal);

    render(await LeadsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole('main')).toBeNull();
  });
});
