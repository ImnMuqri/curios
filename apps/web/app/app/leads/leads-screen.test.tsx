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
  { id: 'l1', phone: '+60127814402', score: 3, slots: { product: 'Kek coklat, 2kg', date: 'Sat 24 Oct', location: 'Klang' }, status: 'NEW', createdAt: new Date('2026-10-17T05:35:00Z'), transcript, capturedAfter: 2 },
  { id: 'l2', phone: '+601120457788', score: 1, slots: { product: 'Wedding cake, 3 tiers', date: null, location: null }, status: 'CONTACTED', createdAt: new Date('2026-10-16T03:00:00Z'), transcript, capturedAfter: 2 },
  { id: 'l3', phone: '+60135576610', score: 0, slots: null, status: 'CLOSED', createdAt: new Date('2026-10-13T03:00:00Z'), transcript, capturedAfter: 2 },
];

function show(list = leads, calls?: Partial<LeadActions>) {
  const actions: LeadActions = { setStatus: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), ...calls };
  const onChanged = vi.fn();
  render(
    <LeadsScreen
      leads={list}
      stats={{ waiting: 1, week: [0, 0, 0, 0, 1, 1, 1], sold: 1 }}
      handle="keklina"
      displayName="Kek Lina"
      language="en"
      publicUrl="https://curios.my/keklina"
      look={{ accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null }}
      now={now}
      keptMonths={12}
      actions={actions}
      onChanged={onChanged}
    />,
  );
  return { actions, onChanged };
}

const figures = () => within(screen.getByRole('list', { name: 'Your leads' }));
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
    expect(figures().getByText('New, waiting for you').previousSibling).toHaveTextContent('1');
    expect(figures().getByText('Numbers left this week').previousSibling).toHaveTextContent('3');
    expect(figures().getByText('Closed into a sale').previousSibling).toHaveTextContent('1');
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

describe('LeadsScreen, the status', () => {
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
