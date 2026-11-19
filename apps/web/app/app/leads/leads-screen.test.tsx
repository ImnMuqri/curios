import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LeadStats, OwnerLead } from '@curios/db-read';
import { LeadsScreen, soldRate, weekLine } from './leads-screen.js';
import type { LeadActions, LeadRow } from './lead-detail.js';

const now = new Date('2026-10-17T06:00:00Z');
const transcript = [
  { role: 'USER' as const, content: 'nak tanya kek coklat 2kg berapa?' },
  { role: 'ASSISTANT' as const, content: 'Kek coklat moist 2kg is RM170.' },
];
const at = (iso: string) => ({ createdAt: new Date(iso), startedAt: new Date(iso) });
const leads: OwnerLead[] = [
  { id: 'l1', phone: '+60127814402', score: 3, slots: { product: 'Kek coklat, 2kg', date: 'Sat 24 Oct', location: 'Klang' }, status: 'NEW', ...at('2026-10-17T05:35:00Z'), transcript, messageCount: 2, capturedAfter: 2, enquiry: null },
  { id: 'l2', phone: '+601120457788', score: 1, slots: { product: 'Wedding cake, 3 tiers', date: null, location: null }, status: 'CONTACTED', ...at('2026-10-16T03:00:00Z'), transcript, messageCount: 2, capturedAfter: 2, enquiry: null },
  { id: 'l3', phone: '+60135576610', score: 0, slots: null, status: 'CLOSED', ...at('2026-10-13T03:00:00Z'), transcript, messageCount: 2, capturedAfter: 2, enquiry: null },
];

// An enquiry from an Ask item in the shop, newest, as the board lists it.
const enquiry: OwnerLead = {
  id: 'e1',
  phone: '+60123456789',
  score: 2,
  slots: { product: 'Custom birthday cake, 20 people', date: 'Sun 15 Nov', location: null, people: '20 people', budget: 'About RM250' },
  status: 'NEW',
  ...at('2026-10-17T05:59:30Z'),
  transcript: [{ role: 'USER', content: 'Enquiry from the shop: Custom birthday cake. Frozen theme, 2 tiers.' }],
  messageCount: 1,
  capturedAfter: 1,
  enquiry: { name: 'Farah', note: 'Frozen theme, 2 tiers.', item: { name: 'Custom birthday cake', photoKey: null, fromCents: 18000 } },
};

const stats: LeadStats = { waiting: 1, thisWeek: 3, sold: 1, lastWeek: 2, days: [0, 0, 1, 0, 1, 1, 0], soldThisWeek: 1 };

function show(list: LeadRow[] = leads, options: { calls?: Partial<LeadActions>; paging?: { older: string | null; paged: boolean }; stats?: LeadStats } = {}) {
  const actions: LeadActions = { setStatus: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), ...options.calls };
  const onChanged = vi.fn();
  const view = (rows: LeadRow[]) => (
    <LeadsScreen
      leads={rows}
      paging={options.paging}
      stats={options.stats ?? stats}
      displayName="Kek Lina"
      language="en"
      publicUrl="https://curios.my/keklina"
      now={now}
      keptMonths={12}
      actions={actions}
      onChanged={onChanged}
    />
  );
  const { rerender } = render(view(list));
  // The server's read after a move: the same screen, new rows.
  const refresh = (rows: LeadRow[]) => rerender(view(rows));
  return { actions, onChanged, refresh };
}

const list = () => within(screen.getByRole('list', { name: 'Leads' }));
const rowOf = (phone: RegExp) => list().getByRole('button', { name: phone });
const chip = (name: RegExp) => within(screen.getByRole('group', { name: 'Show leads' })).getByRole('button', { name });
const strip = () => within(screen.getByRole('group', { name: 'Leads at a glance' }));
const statusSwitch = () => within(screen.getByRole('radiogroup', { name: 'Lead status' }));
const phones = () => list().getAllByRole('button').map((b) => b.querySelector('b')!.textContent);

describe('LeadsScreen, the header', () => {
  it('is the calm board’s: Inbox, Leads, and one line', () => {
    show();
    const header = screen.getByRole('heading', { name: 'Leads', level: 1 }).closest('header')!;
    expect(within(header).getByText('Inbox')).toBeInTheDocument();
    expect(within(header).getByText('People your page couldn’t answer, with what they asked.')).toBeInTheDocument();
  });

  it('says how long numbers are kept, at the list’s foot', () => {
    show();
    expect(screen.getByText('Newest first · kept for 12 months')).toBeInTheDocument();
  });

  it('puts the toast outside the screen, so a phone’s own view never hides it', () => {
    show();
    const status = screen.getByRole('status');
    expect(status.closest('header')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Leads', level: 1 }).closest('header')!.parentElement!.contains(status)).toBe(false);
  });
});

describe('LeadsScreen, the stat cards', () => {
  it('shows the new ones (urgent, Reply to them), this week with its line and spark, and the sales with their share', () => {
    show();
    const cards = strip();
    const first = cards.getByRole('button', { name: /New, not contacted/ });
    expect(first).toHaveTextContent('New, not contacted1Reply to them →');
    const week = cards.getByText('Left a number this week').parentElement!;
    expect(week).toHaveTextContent('3');
    expect(week).toHaveTextContent('+1 on last week');
    expect(week.querySelectorAll('svg rect')).toHaveLength(7);
    const sold = cards.getByText('Became sales').parentElement!;
    expect(sold).toHaveTextContent('Became sales133% of this week’s leads');
    expect(sold.querySelector('u')).toHaveStyle({ width: '33%' });
  });

  it('draws exactly seven days in the spark, whatever comes', () => {
    show(leads, { stats: { ...stats, days: [9, 9, 1, 2, 3, 4, 5, 6, 7] } });
    expect(strip().getByText('Left a number this week').parentElement!.querySelectorAll('svg rect')).toHaveLength(7);
  });

  it('says the week against the last one, signed, or the same', () => {
    expect(weekLine(9, 6)).toBe('+3 on last week');
    expect(weekLine(2, 5)).toBe('−3 on last week');
    expect(weekLine(4, 4)).toBe('Same as last week');
  });

  it('gives a real rate, 0 when nobody left a number this week', () => {
    expect(soldRate(3, 9)).toBeCloseTo(1 / 3);
    expect(soldRate(0, 0)).toBe(0);
    show(leads, { stats: { ...stats, thisWeek: 0, lastWeek: 0, soldThisWeek: 0, days: [0, 0, 0, 0, 0, 0, 0] } });
    const sold = strip().getByText('Became sales').parentElement!;
    expect(sold).toHaveTextContent('0% of this week’s leads');
    expect(sold.querySelector('u')).toHaveStyle({ width: '0%' });
    expect(strip().getByText('Same as last week')).toBeInTheDocument();
  });

  it('filters the list to the new ones from the urgent card, and back on a second press', () => {
    show();
    const card = strip().getByRole('button', { name: /New, not contacted/ });
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(chip(/^New/)).toHaveAttribute('aria-pressed', 'true');
    expect(phones()).toEqual(['+60 12-781 4402']);
    fireEvent.click(card);
    expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true');
    expect(phones()).toHaveLength(3);
  });

  it('presses the card when the New chip is picked: one rule for both', () => {
    show();
    fireEvent.click(chip(/^New/));
    expect(strip().getByRole('button', { name: /New, not contacted/ })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('LeadsScreen, the list', () => {
  it('shows each number as written, what they asked for, and the status tag, with no heat dots or new dot', () => {
    show();
    const first = rowOf(/\+60 12-781 4402/);
    expect(first).toHaveTextContent('#+60 12-781 4402Kek coklat, 2kg · Sat 24 Oct · KlangNew');
    expect(within(first).queryByLabelText(/of 3 details/)).toBeNull();
    expect(within(first).queryByLabelText('New')).toBeNull();
    expect(rowOf(/\+60 13-557 6610/)).toHaveTextContent('Nothing picked out yet');
    expect(rowOf(/\+60 11-2045 7788/)).toHaveTextContent('Contacted');
  });

  it('tags each status in its colour: New blue, Sold green, Contacted and Closed grey', () => {
    show([...leads, { ...leads[2]!, id: 'l4', phone: '+60199999999', status: 'SOLD' }]);
    const tag = (phone: RegExp, label: string) => within(rowOf(phone)).getByText(label, { selector: 'span' });
    expect(tag(/12-781/, 'New')).toHaveAttribute('data-tone', 'new');
    expect(tag(/19-999/, 'Sold')).toHaveAttribute('data-tone', 'ok');
    expect(tag(/11-2045/, 'Contacted')).not.toHaveAttribute('data-tone');
    expect(tag(/13-557/, 'Closed')).not.toHaveAttribute('data-tone');
  });

  it('marks an enquiry from the shop with its mini-label, item and date', () => {
    show([enquiry, ...leads]);
    const row = rowOf(/\+60 12-345 6789/);
    expect(within(row).getByText('Enquiry')).toBeInTheDocument();
    expect(row).toHaveTextContent('EnquiryCustom birthday cake · Sun 15 Nov');
    expect(within(rowOf(/\+60 12-781 4402/)).queryByText('Enquiry')).toBeNull();
  });

  it('opens the newest first, and the one chosen', () => {
    show();
    expect(screen.getByRole('heading', { level: 2, name: '+60 12-781 4402' })).toBeInTheDocument();
    fireEvent.click(rowOf(/\+60 11-2045 7788/));
    expect(screen.getByRole('heading', { level: 2, name: '+60 11-2045 7788' })).toBeInTheDocument();
    expect(rowOf(/\+60 11-2045 7788/)).toHaveAttribute('aria-current', 'true');
  });

  it('filters by status, counting the new ones as the card does, and hides a count of 0', () => {
    show();
    expect(screen.getByRole('group', { name: 'Show leads' }).querySelectorAll('u')).toHaveLength(1);
    expect(chip(/^New/)).toHaveTextContent('New1');
    fireEvent.click(chip(/^Contacted/));
    expect(phones()).toEqual(['+60 11-2045 7788']);
    show(leads, { stats: { ...stats, waiting: 0 } });
    expect(screen.getAllByRole('group', { name: 'Show leads' })[1]!.querySelector('u')).toBeNull();
  });

  it('says nothing is here yet under an empty filter', () => {
    show([leads[1]!]);
    fireEvent.click(chip(/^New/));
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.getByText('New numbers land here as people leave them.')).toBeInTheDocument();
    fireEvent.click(chip(/^Sold/));
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(screen.queryByText('New numbers land here as people leave them.')).toBeNull();
  });
});

describe('LeadsScreen, the search', () => {
  const search = () => screen.getByRole('searchbox', { name: 'Search number or what they want' });

  it('narrows the list by the number’s digits, however typed, or by what they want', () => {
    show();
    fireEvent.change(search(), { target: { value: '12-781' } });
    expect(phones()).toEqual(['+60 12-781 4402']);
    fireEvent.change(search(), { target: { value: 'wedding' } });
    expect(phones()).toEqual(['+60 11-2045 7788']);
    expect(screen.getByRole('heading', { level: 2, name: '+60 11-2045 7788' })).toBeInTheDocument();
  });

  it('says No match, in the board’s words', () => {
    show();
    fireEvent.change(search(), { target: { value: 'pavlova' } });
    expect(screen.getByText('No match')).toBeInTheDocument();
    expect(screen.getByText('Try part of a number, or what they wanted.')).toBeInTheDocument();
  });

  it('finds an enquiry by its item or their name', () => {
    show([enquiry, ...leads]);
    fireEvent.change(search(), { target: { value: 'birthday' } });
    expect(phones()).toEqual(['+60 12-345 6789']);
    fireEvent.change(search(), { target: { value: 'farah' } });
    expect(phones()).toEqual(['+60 12-345 6789']);
  });
});

describe('LeadsScreen, the status', () => {
  it('moves a lead at once, saves it, re-reads the screen, and says so', async () => {
    const { actions, onChanged } = show();
    await act(async () => {
      fireEvent.click(statusSwitch().getByRole('radio', { name: 'Closed' }));
    });
    expect(actions.setStatus).toHaveBeenCalledWith('l1', 'CLOSED');
    expect(statusSwitch().getByRole('radio', { name: 'Closed' })).toHaveAttribute('aria-checked', 'true');
    expect(rowOf(/\+60 12-781 4402/)).toHaveTextContent('Closed');
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Marked closed.');
  });

  it('puts it back, and says why in the error toast, when the save fails', async () => {
    show(leads, { calls: { setStatus: vi.fn(async () => Promise.reject(new Error('No such lead.'))) } });
    await act(async () => {
      fireEvent.click(statusSwitch().getByRole('radio', { name: 'Contacted' }));
    });
    expect(statusSwitch().getByRole('radio', { name: 'New' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('No such lead.');
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('flips a new lead to Contacted when the first message is sent, keeping the message and turning Send into the done line', async () => {
    const { actions } = show();
    const send = screen.getByRole('link', { name: 'Send on WhatsApp' });
    expect(send.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/60127814402\?text=/);
    send.addEventListener('click', (event) => event.preventDefault());
    fireEvent.change(screen.getByRole('textbox', { name: 'First message' }), { target: { value: 'Hi! RM170 for 2kg.' } });
    send.focus();
    await act(async () => {
      fireEvent.click(send);
    });
    expect(actions.setStatus).toHaveBeenCalledWith('l1', 'CONTACTED');
    expect(screen.getByRole('status')).toHaveTextContent('WhatsApp opened. Marked contacted.');
    expect(statusSwitch().getByRole('radio', { name: 'Contacted' })).toHaveAttribute('aria-checked', 'true');
    // The board (Dash.html 1887): the box stays, with the owner's edit and Copy; the same link is now the done line.
    expect(screen.getByRole('textbox', { name: 'First message' })).toHaveValue('Hi! RM170 for 2kg.');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    const done = screen.getByRole('link', { name: 'WhatsApp opened. Marked contacted.' });
    expect(done).toBe(send);
    expect(done).toHaveFocus();
    expect(done).toHaveAttribute('href', `https://wa.me/60127814402?text=${encodeURIComponent('Hi! RM170 for 2kg.')}`);
    expect(screen.queryByRole('link', { name: 'Open WhatsApp' })).toBeNull();
    // Opening it again changes nothing more.
    await act(async () => {
      fireEvent.click(done);
    });
    expect(actions.setStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(/^WhatsApp opened\.$/);
  });

  it('keeps a lead sent under the New filter on screen on a wide screen, with focus where it was', async () => {
    const second: OwnerLead = { ...leads[0]!, id: 'l5', phone: '+60125550000', ...at('2026-10-17T04:00:00Z') };
    show([leads[0]!, second, leads[1]!], { stats: { ...stats, waiting: 2 } });
    fireEvent.click(chip(/^New/));
    const send = screen.getByRole('link', { name: 'Send on WhatsApp' });
    send.addEventListener('click', (event) => event.preventDefault());
    send.focus();
    await act(async () => {
      fireEvent.click(send);
    });
    expect(screen.getByRole('heading', { level: 2, name: '+60 12-781 4402' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'WhatsApp opened. Marked contacted.' })).toHaveFocus();
    // It left the New list; picking the next one lets go.
    expect(phones()).toEqual(['+60 12-555 0000']);
    fireEvent.click(rowOf(/\+60 12-555 0000/));
    expect(screen.getByRole('heading', { level: 2, name: '+60 12-555 0000' })).toBeInTheDocument();
  });

  it('keeps focus on the status after a move takes the lead out of the filter', async () => {
    show();
    fireEvent.click(chip(/^New/));
    const closed = statusSwitch().getByRole('radio', { name: 'Closed' });
    closed.focus();
    await act(async () => {
      fireEvent.click(closed);
    });
    expect(screen.getByRole('heading', { level: 2, name: '+60 12-781 4402' })).toBeInTheDocument();
    expect(statusSwitch().getByRole('radio', { name: 'Closed' })).toHaveFocus();
  });

  it('leaves a lead past New where it is when WhatsApp is opened', async () => {
    const { actions } = show();
    fireEvent.click(rowOf(/\+60 13-557 6610/));
    const open = screen.getByRole('link', { name: 'Open WhatsApp' });
    open.addEventListener('click', (event) => event.preventDefault());
    await act(async () => {
      fireEvent.click(open);
    });
    expect(actions.setStatus).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/^WhatsApp opened\.$/);
  });
});

describe('LeadsScreen, deleting', () => {
  it('asks in the board’s words, then takes the number off the list at once and says so', async () => {
    const { actions, onChanged } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete lead' }));
    const confirm = screen.getByRole('group', { name: 'Delete lead' });
    expect(confirm).toHaveTextContent('Delete this number and the conversation with it? It cannot be brought back.');
    expect(within(confirm).getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, delete' }));
    });
    expect(actions.remove).toHaveBeenCalledWith('l1');
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Lead deleted.');
    expect(phones()).toEqual(['+60 11-2045 7788', '+60 13-557 6610']);
    await waitFor(() => expect(rowOf(/\+60 11-2045 7788/)).toHaveFocus());
  });

  it('keeps the number and the confirm, and says why in the error toast, when deleting fails', async () => {
    show(leads, { calls: { remove: vi.fn(async () => Promise.reject(new Error('No such lead.'))) } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete lead' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('No such lead.');
    expect(screen.getByRole('group', { name: 'Delete lead' })).toBeInTheDocument();
    expect(phones()).toHaveLength(3);
  });
});

describe('LeadsScreen, before any numbers', () => {
  it('shows Peek, says how numbers arrive, and offers the link to share', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    show([]);
    expect(screen.getByRole('heading', { level: 2, name: 'No numbers yet' })).toBeInTheDocument();
    expect(
      screen.getByText('When the chat can’t answer, it offers to pass the question to you. Numbers people leave show up here, with what they were asking.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Leads at a glance' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy your link' }));
    expect(writeText).toHaveBeenCalledWith('https://curios.my/keklina');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});

describe('LeadsScreen, paging', () => {
  it('offers no paging on a first page that holds them all', () => {
    show();
    expect(screen.queryByRole('navigation', { name: 'More leads' })).toBeNull();
  });

  it('links to older leads below the last one shown, and back to the newest from further down', () => {
    show(leads, { paging: { older: 'l3', paged: true } });
    const nav = screen.getByRole('navigation', { name: 'More leads' });
    expect(within(nav).getByRole('link', { name: 'Older leads' })).toHaveAttribute('href', '/app/leads?before=l3');
    expect(within(nav).getByRole('link', { name: 'Newest' })).toHaveAttribute('href', '/app/leads');
  });
});

describe('LeadsScreen, on a phone', () => {
  let matches = true;
  beforeEach(() => {
    matches = true;
    vi.stubGlobal('matchMedia', (query: string) => ({ matches, media: query, addEventListener() {}, removeEventListener() {} }));
  });
  afterEach(() => vi.unstubAllGlobals());

  const split = () => document.querySelector('[data-lead-row]')?.closest('ul')?.parentElement?.parentElement ?? document.querySelector('[data-open]');
  const back = () => screen.getByRole('button', { name: 'All leads' });

  it('opens a picked lead as its own view with "‹ All leads", focusing its heading, and goes back to its row', async () => {
    show();
    expect(split()).not.toHaveAttribute('data-open');
    fireEvent.click(rowOf(/\+60 11-2045 7788/));
    expect(split()).toHaveAttribute('data-open');
    expect(back()).toHaveTextContent('‹All leads');
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: '+60 11-2045 7788' })).toHaveFocus());
    fireEvent.click(back());
    expect(split()).not.toHaveAttribute('data-open');
    await waitFor(() => expect(rowOf(/\+60 11-2045 7788/)).toHaveFocus());
  });

  it('keeps the detail beside the list on a wide screen: no own view, focus stays on the row', () => {
    matches = false;
    show();
    const row = rowOf(/\+60 11-2045 7788/);
    row.focus();
    fireEvent.click(row);
    expect(split()).not.toHaveAttribute('data-open');
    expect(row).toHaveFocus();
  });

  it('holds the open lead after it leaves the filter (sent under New), until the owner goes back', async () => {
    const second: OwnerLead = { ...leads[0]!, id: 'l5', phone: '+60125550000', ...at('2026-10-17T04:00:00Z') };
    const { refresh } = show([leads[0]!, second, leads[1]!], { stats: { ...stats, waiting: 2 } });
    fireEvent.click(chip(/^New/));
    fireEvent.click(rowOf(/\+60 12-781 4402/));
    const send = screen.getByRole('link', { name: 'Send on WhatsApp' });
    send.addEventListener('click', (event) => event.preventDefault());
    await act(async () => {
      fireEvent.click(send);
    });
    refresh([{ ...leads[0]!, status: 'CONTACTED' }, second, leads[1]!]);
    // Not blank, and not the next new lead under the same thumb: the same number, now contacted.
    expect(document.querySelector('[data-open]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: '+60 12-781 4402' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: '+60 12-555 0000' })).toBeNull();
    fireEvent.click(back());
    expect(document.querySelector('[data-open]')).toBeNull();
    expect(phones()).toEqual(['+60 12-555 0000']);
    // Its row left the list: focus falls back to the first row.
    await waitFor(() => expect(rowOf(/\+60 12-555 0000/)).toHaveFocus());
  });

  it('closes the own view from a chip, a card and the search', () => {
    show();
    fireEvent.click(rowOf(/\+60 11-2045 7788/));
    fireEvent.click(chip(/^All/));
    expect(document.querySelector('[data-open]')).toBeNull();
    fireEvent.click(rowOf(/\+60 11-2045 7788/));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '11' } });
    expect(document.querySelector('[data-open]')).toBeNull();
    fireEvent.click(rowOf(/\+60 11-2045 7788/));
    fireEvent.click(strip().getByRole('button', { name: /New, not contacted/ }));
    expect(document.querySelector('[data-open]')).toBeNull();
  });

  it('goes back to the list after a delete, saying so, with focus on the first row', async () => {
    show();
    fireEvent.click(rowOf(/\+60 11-2045 7788/));
    fireEvent.click(screen.getByRole('button', { name: 'Delete lead' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    });
    expect(document.querySelector('[data-open]')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Lead deleted.');
    expect(phones()).toEqual(['+60 12-781 4402', '+60 13-557 6610']);
    await waitFor(() => expect(rowOf(/\+60 12-781 4402/)).toHaveFocus());
  });

  it('goes back to the list, saying so, when the open lead is gone from the list altogether', async () => {
    const { refresh } = show();
    fireEvent.click(rowOf(/\+60 11-2045 7788/));
    refresh(leads.filter((lead) => lead.id !== 'l2'));
    await waitFor(() => expect(document.querySelector('[data-open]')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('That lead is no longer in this list.');
  });
});
