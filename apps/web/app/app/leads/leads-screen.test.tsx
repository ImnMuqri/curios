import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { OwnerLead } from '@curios/db-read';
import { LeadsScreen } from './leads-screen.js';
import type { LeadActions } from './lead-detail.js';

const now = new Date('2026-10-17T06:00:00Z');
const transcript = [
  { role: 'USER' as const, content: 'nak tanya kek coklat 2kg berapa?' },
  { role: 'ASSISTANT' as const, content: 'Kek coklat moist 2kg is RM170.' },
];
const leads: OwnerLead[] = [
  { id: 'l1', phone: '+60127814402', score: 3, slots: { product: 'Kek coklat, 2kg', date: 'Sat 24 Oct', location: 'Klang' }, status: 'NEW', createdAt: new Date('2026-10-17T05:35:00Z'), transcript, messageCount: 2, capturedAfter: 2 },
  { id: 'l2', phone: '+601120457788', score: 1, slots: { product: 'Wedding cake, 3 tiers', date: null, location: null }, status: 'CONTACTED', createdAt: new Date('2026-10-16T03:00:00Z'), transcript, messageCount: 2, capturedAfter: 2 },
  { id: 'l3', phone: '+60135576610', score: 0, slots: null, status: 'CLOSED', createdAt: new Date('2026-10-13T03:00:00Z'), transcript, messageCount: 2, capturedAfter: 2 },
];

function show(list = leads, calls?: Partial<LeadActions>, paging?: { older: string | null; paged: boolean }) {
  const actions: LeadActions = { setStatus: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), ...calls };
  const onChanged = vi.fn();
  render(
    <LeadsScreen
      leads={list}
      paging={paging}
      stats={{ waiting: 1, thisWeek: 3, sold: 1 }}
      handle="keklina"
      displayName="Kek Lina"
      language="en"
      publicUrl="https://curios.my/keklina"
      now={now}
      keptMonths={12}
      actions={actions}
      onChanged={onChanged}
    />,
  );
  return { actions, onChanged };
}

// The header's one sentence, which carries the figures the stat cards used to (Dashboard v2).
const summary = () => screen.getByRole('heading', { name: 'Leads', level: 1 }).closest('header')!.querySelector('p')!;
const list = () => within(screen.getByRole('list', { name: 'Leads' }));
const filter = (name: RegExp) => within(screen.getByRole('tablist', { name: 'Show leads' })).getByRole('tab', { name });
const statusSwitch = () => within(screen.getByRole('radiogroup', { name: 'Lead status' }));

describe('LeadsScreen, the figures', () => {
  it('says how long numbers are kept', () => {
    show();
    expect(screen.getByText('Numbers visitors left in the chat · kept for 12 months')).toBeInTheDocument();
  });

  it('counts what waits, this week’s numbers, and what became a sale', () => {
    show();
    expect(summary()).toHaveTextContent('1 new number is waiting for you. 3 people left their number this week, and 1 became a sale.');
    expect(summary().querySelector('b')).toHaveTextContent('1 new number');
    expect(screen.queryByRole('list', { name: 'Your leads' })).toBeNull();
  });
});

describe('LeadsScreen, the list', () => {
  it('shows each number as written, what they asked for, when, and how much they said', () => {
    show();
    const first = list().getByRole('button', { name: /\+60 12-781 4402/ });
    expect(first).toHaveTextContent('Kek coklat, 2kg · Sat 24 Oct · Klang');
    expect(first).toHaveTextContent('25 min ago');
    expect(within(first).getByLabelText('3 of 3 details')).toBeInTheDocument();
    expect(within(first).getByLabelText('New')).toBeInTheDocument();
    expect(list().getByRole('button', { name: /\+60 13-557 6610/ })).toHaveTextContent('Nothing picked out yet');
  });

  it('opens the newest first, and the one chosen', () => {
    show();
    expect(screen.getByRole('heading', { name: '+60 12-781 4402' })).toBeInTheDocument();
    fireEvent.click(list().getByRole('button', { name: /\+60 11-2045 7788/ }));
    expect(screen.getByRole('heading', { name: '+60 11-2045 7788' })).toBeInTheDocument();
  });

  it('filters by status, counting the new ones', () => {
    show();
    expect(filter(/^New/)).toHaveTextContent('1');
    fireEvent.click(filter(/^Contacted/));
    expect(list().getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '+60 11-2045 7788' })).toBeInTheDocument();
  });
});

describe('LeadsScreen, the search', () => {
  const search = () => screen.getByRole('searchbox', { name: 'Search number or what they want' });

  it('narrows the list by the number’s digits, however they are typed, or by what they want', () => {
    show();
    fireEvent.change(search(), { target: { value: '12-781' } });
    expect(list().getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '+60 12-781 4402' })).toBeInTheDocument();
    fireEvent.change(search(), { target: { value: 'wedding' } });
    expect(list().getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '+60 11-2045 7788' })).toBeInTheDocument();
    fireEvent.change(search(), { target: { value: 'pavlova' } });
    expect(screen.getByText('No number here matches “pavlova”.')).toBeInTheDocument();
  });
});

describe('LeadsScreen, the status', () => {
  it('sits beside the number, in the same row as Open WhatsApp', () => {
    show();
    const head = screen.getByRole('heading', { name: '+60 12-781 4402' }).closest('div')!;
    expect(within(head).getByRole('radiogroup', { name: 'Lead status' })).toBeInTheDocument();
    expect(within(head).getByRole('link', { name: 'Open WhatsApp' })).toBeInTheDocument();
  });

  it('moves a lead at once, saves it, and re-reads the screen', async () => {
    const { actions, onChanged } = show();
    await act(async () => { fireEvent.click(statusSwitch().getByRole('radio', { name: 'Closed' })); });
    expect(actions.setStatus).toHaveBeenCalledWith('l1', 'CLOSED');
    expect(statusSwitch().getByRole('radio', { name: 'Closed' })).toHaveAttribute('aria-checked', 'true');
    expect(within(list().getByRole('button', { name: /\+60 12-781 4402/ })).queryByLabelText('New')).toBeNull();
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Marked closed.');
  });

  it('marks a sale apart from a close', async () => {
    const { actions } = show();
    expect(statusSwitch().getAllByRole('radio').map((r) => r.textContent)).toEqual(['New', 'Contacted', 'Sold', 'Closed']);
    await act(async () => { fireEvent.click(statusSwitch().getByRole('radio', { name: 'Sold' })); });
    expect(actions.setStatus).toHaveBeenCalledWith('l1', 'SOLD');
    expect(screen.getByRole('status')).toHaveTextContent('Marked sold.');
  });

  it('puts it back, and says why, when the save fails', async () => {
    show(leads, { setStatus: vi.fn(async () => { throw new Error('No such lead.'); }) });
    await act(async () => { fireEvent.click(statusSwitch().getByRole('radio', { name: 'Contacted' })); });
    expect(statusSwitch().getByRole('radio', { name: 'New' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('No such lead.');
  });

  it('marks a new lead contacted when the owner opens WhatsApp, and leaves others be', async () => {
    const { actions } = show();
    const open = screen.getByRole('link', { name: 'Open WhatsApp' });
    expect(open).toHaveAttribute('href', 'https://wa.me/60127814402');
    open.addEventListener('click', (event) => event.preventDefault());
    await act(async () => { fireEvent.click(open); });
    expect(actions.setStatus).toHaveBeenCalledWith('l1', 'CONTACTED');
    expect(screen.getByRole('status')).toHaveTextContent('WhatsApp opened. Marked contacted.');

    fireEvent.click(list().getByRole('button', { name: /\+60 13-557 6610/ }));
    const again = screen.getByRole('link', { name: 'Open WhatsApp' });
    again.addEventListener('click', (event) => event.preventDefault());
    await act(async () => { fireEvent.click(again); });
    expect(actions.setStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(/^WhatsApp opened\.$/);
  });

  it('says a deleted lead is gone, after its panel has closed', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete lead' }));
    const confirm = screen.getByRole('group', { name: 'Confirm deleting this lead' });
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, delete' })); });
    expect(screen.getByRole('status')).toHaveTextContent('Lead deleted.');
  });
});

describe('LeadsScreen, before any numbers', () => {
  it('says how numbers arrive, and offers the link to share', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    show([]);
    expect(screen.getByRole('heading', { name: 'No numbers yet' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy your link' }));
    expect(writeText).toHaveBeenCalledWith('https://curios.my/keklina');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});

describe('LeadsScreen, without the template look', () => {
  it('says its numbers in words: no icon tiles, no bars in the header', () => {
    show();
    const header = screen.getByRole('heading', { name: 'Leads', level: 1 }).closest('header')!;
    expect(header.querySelector('svg')).toBeNull();
    expect(header.querySelector('[data-tone]')).toBeNull();
  });

  it('lists each lead as text, with no avatar tile', () => {
    show();
    expect(screen.getByRole('list', { name: 'Leads' }).querySelector('svg')).toBeNull();
    expect(document.querySelector('[class*="avatar"]')).toBeNull();
  });

  it('lists what they are after as text, with no icon tile on each', () => {
    show();
    const after = screen.getByRole('heading', { name: /What they’re after|What they're after/ }).closest('section')!;
    expect(after.querySelector('[class*="slotIcon"]')).toBeNull();
    expect(after).toHaveTextContent('Kek coklat, 2kg');
  });

  it('offers no paging on a first page that holds them all', () => {
    show();
    expect(screen.queryByRole('navigation', { name: 'More leads' })).toBeNull();
  });

  it('links to older leads below the last one shown, and back to the newest from further down', () => {
    show(leads, undefined, { older: 'l3', paged: true });
    const nav = screen.getByRole('navigation', { name: 'More leads' });
    expect(within(nav).getByRole('link', { name: 'Older leads' })).toHaveAttribute('href', '/app/leads?before=l3');
    expect(within(nav).getByRole('link', { name: 'Newest' })).toHaveAttribute('href', '/app/leads');
  });
});
