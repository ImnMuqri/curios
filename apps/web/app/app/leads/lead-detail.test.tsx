import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { OwnerLead } from '@curios/db-read';
import { detailsKnown, LeadDetail, leadWhen, READY, type LeadActions, type LeadRow, type LeadStatus } from './lead-detail.js';

const now = new Date('2026-10-17T06:00:00Z'); // 2pm in Malaysia

const lead: OwnerLead = {
  id: 'l1',
  phone: '+60127814402',
  score: 2,
  slots: { product: 'Kek coklat, 2kg', date: null, location: 'Klang' },
  status: 'NEW',
  // The number at 1:35pm, the chat begun at 1:30pm, Malaysian time.
  createdAt: new Date('2026-10-17T05:35:00Z'),
  startedAt: new Date('2026-10-17T05:30:00Z'),
  transcript: [
    { role: 'USER', content: 'nak tanya kek coklat 2kg berapa?' },
    { role: 'ASSISTANT', content: 'Kek coklat moist 2kg is RM170.' },
    { role: 'USER', content: 'ok terima kasih' },
  ],
  messageCount: 3,
  // The number was left after the second message, before the thanks.
  capturedAfter: 2,
  enquiry: null,
};

// An enquiry from an Ask item in the shop (HANDOFF "Shop: Ask items", 8 Nov 2026), as on the Leads board.
const note = 'For 20 people on Sun 15 Nov. Frozen theme, 2 tiers, with “Aisyah” on top. Budget around RM250.';
const enquiryLead: LeadRow = {
  id: 'e1',
  phone: '+60123456789',
  score: 2,
  slots: { product: 'Custom birthday cake, 20 people', date: 'Sun 15 Nov', location: null, people: '20 people', budget: null },
  status: 'NEW',
  createdAt: new Date('2026-10-17T00:02:00Z'),
  startedAt: new Date('2026-10-17T00:02:00Z'),
  transcript: [
    { role: 'USER', content: `Enquiry from the shop: Custom birthday cake. ${note}` },
    { role: 'ASSISTANT', content: 'Thanks! Custom birthday cakes start from RM180. Lina will reply on WhatsApp with a price.' },
  ],
  messageCount: 2,
  capturedAfter: 1,
  enquiry: { name: 'Farah', note, item: { name: 'Custom birthday cake', photoKey: null, fromCents: 18000 } },
};

interface Options {
  calls?: Partial<LeadActions>;
  shown?: LeadRow;
  language?: string;
  status?: LeadStatus;
  onStatus?: (status: LeadStatus) => Promise<void>;
  sent?: boolean;
  onSent?: () => void;
}

function show({ calls = {}, shown = lead, language = 'en', status = 'NEW', onStatus = vi.fn(async () => undefined), sent, onSent }: Options = {}) {
  const actions: LeadActions = { setStatus: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), ...calls };
  const onDeleted = vi.fn();
  const say = vi.fn();
  const fail = vi.fn();
  render(
    <LeadDetail
      lead={shown}
      status={status}
      displayName="Kek Lina"
      language={language}
      now={now}
      actions={actions}
      onStatus={onStatus}
      onDeleted={onDeleted}
      say={say}
      fail={fail}
      sent={sent}
      onSent={onSent}
    />,
  );
  return { actions, onDeleted, say, fail, onStatus };
}


describe('LeadDetail, the head', () => {
  it('says where it came from and when the chat began, then the number', () => {
    show();
    expect(screen.getByText('From the chat · Today 1:30pm')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '+60 12-781 4402' })).toHaveAttribute('tabindex', '-1');
  });

  it('says an enquiry came from the shop', () => {
    show({ shown: enquiryLead });
    expect(screen.getByText('Enquiry from the shop · Today 8:02am')).toBeInTheDocument();
  });

  it('says the day alone for an older lead, as the board does', () => {
    expect(leadWhen(new Date('2026-10-13T02:00:00Z'), now)).toBe('Tue 13 Oct');
    expect(leadWhen(new Date('2026-10-16T08:30:00Z'), now)).toBe('Yesterday 4:30pm');
    expect(leadWhen(new Date('2026-10-13T02:00:00Z'), now, true)).toBe('Tue 13 Oct, 10:00am');
    expect(leadWhen(new Date('2026-10-17T01:14:00Z'), now, true)).toBe('Today, 9:14am');
  });

  it('shows where the owner is with it as a four-way segment', () => {
    show({ status: 'CONTACTED' });
    const group = within(screen.getByRole('radiogroup', { name: 'Lead status' }));
    expect(group.getAllByRole('radio').map((r) => r.textContent)).toEqual(['New', 'Contacted', 'Sold', 'Closed']);
    expect(group.getByRole('radio', { name: 'Contacted' })).toHaveAttribute('aria-checked', 'true');
    expect(group.getByRole('radio', { name: 'New' })).toHaveAttribute('aria-checked', 'false');
  });

  it('sends a status the owner picks, and says it in the toast', async () => {
    const { onStatus, say } = show();
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Sold' }));
    });
    expect(onStatus).toHaveBeenCalledWith('SOLD');
    expect(say).toHaveBeenCalledWith('Marked sold.');
  });

  it('puts a failed status in the error toast, never the success one', async () => {
    const { say, fail } = show({ onStatus: vi.fn(async () => Promise.reject(new Error('No such lead.'))) });
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Closed' }));
    });
    expect(fail).toHaveBeenCalledWith('No such lead.');
    expect(say).not.toHaveBeenCalled();
  });
});

describe('LeadDetail, the status by keyboard', () => {
  it('is one tab stop, on the checked option', () => {
    show({ status: 'SOLD' });
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '-1', '0', '-1']);
  });

  it.each([
    ['ArrowRight', 'SOLD', 'Sold'],
    ['ArrowDown', 'SOLD', 'Sold'],
    ['ArrowLeft', 'NEW', 'New'],
    ['ArrowUp', 'NEW', 'New'],
    ['Home', 'NEW', 'New'],
    ['End', 'CLOSED', 'Closed'],
  ] as const)('%s moves focus and chooses', async (key, id, label) => {
    const { onStatus } = show({ status: 'CONTACTED' });
    const contacted = screen.getByRole('radio', { name: 'Contacted' });
    contacted.focus();
    await act(async () => {
      fireEvent.keyDown(contacted, { key });
    });
    expect(screen.getByRole('radio', { name: label })).toHaveFocus();
    expect(onStatus).toHaveBeenCalledWith(id);
  });

  it('wraps round the ends', async () => {
    const { onStatus } = show({ status: 'CLOSED' });
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('radio', { name: 'Closed' }), { key: 'ArrowRight' });
    });
    expect(screen.getByRole('radio', { name: 'New' })).toHaveFocus();
    expect(onStatus).toHaveBeenCalledWith('NEW');
  });

  it('ignores other keys', async () => {
    const { onStatus } = show();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('radio', { name: 'New' }), { key: 'a' });
    });
    expect(onStatus).not.toHaveBeenCalled();
  });
});

describe('LeadDetail, the ring', () => {
  const chat = (slots: OwnerLead['slots']) => ({ ...lead, slots });

  it.each([
    [chat(null), 1, 'Start with hello'],
    [chat({ product: 'Kek', date: null, location: null }), 2, 'Ask a little more'],
    [chat({ product: 'Kek', date: 'Sat', location: null }), 3, 'Almost there'],
    [chat({ product: 'Kek', date: 'Sat', location: 'Klang' }), 4, 'Ready to quote'],
  ])('counts the number and the picked-out details: %#', (shown, count, label) => {
    expect(detailsKnown(shown)).toBe(count);
    show({ shown });
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(`${count} of 4 details known`)).toBeInTheDocument();
  });

  it('counts an enquiry by When, For and Budget, not what it wants or where', () => {
    // Wants and Where are known, but they are not an enquiry's details.
    expect(detailsKnown({ ...enquiryLead, slots: { product: 'Cake', date: null, location: 'Klang', people: null, budget: null } })).toBe(1);
    expect(detailsKnown(enquiryLead)).toBe(3);
    expect(detailsKnown({ ...enquiryLead, slots: { ...enquiryLead.slots!, budget: 'RM250' } })).toBe(4);
  });

  it('takes the four words from the owner’s answer', () => {
    expect(READY).toEqual(['Start with hello', 'Ask a little more', 'Almost there', 'Ready to quote']);
  });

  it('ignores the old three-point score', () => {
    show({ shown: { ...lead, score: 3, slots: null } });
    expect(screen.getByText('1 of 4 details known')).toBeInTheDocument();
  });
});

describe('LeadDetail, what was picked out', () => {
  it('lists Wants, When and Where, with "Not mentioned" for a gap', () => {
    show();
    expect(screen.getByText('Picked out of the conversation', { selector: 'p' })).toBeInTheDocument();
    const rows = within(screen.getByLabelText('Picked out of the conversation'));
    expect(rows.getAllByRole('term').map((t) => t.textContent)).toEqual(['Wants', 'When', 'Where']);
    expect(rows.getAllByRole('definition').map((d) => d.textContent)).toEqual(['Kek coklat, 2kg', 'Not mentioned', 'Klang']);
    expect(rows.getByText('Not mentioned').tagName).toBe('I');
  });

  it('shows an enquiry’s item, its starting price, When, For and Budget, their message and their name', () => {
    show({ shown: enquiryLead });
    expect(screen.getByText('Their enquiry', { selector: 'p', exact: false })).toHaveTextContent('Their enquiryPicked out of their message');
    expect(screen.getByText('Custom birthday cake')).toBeInTheDocument();
    expect(screen.getByText('Ask for a price · from RM180')).toBeInTheDocument();
    const rows = within(screen.getByLabelText('Their enquiry'));
    expect(rows.getAllByRole('term').map((t) => t.textContent)).toEqual(['When', 'For', 'Budget']);
    expect(rows.getAllByRole('definition').map((d) => d.textContent)).toEqual(['Sun 15 Nov', '20 people', 'Not mentioned']);
    expect(screen.getByText('Their message').parentElement).toHaveTextContent(`Their message${note}`);
    expect(screen.getByText('Name: Farah')).toBeInTheDocument();
    expect(screen.queryByText('Picked out of the conversation')).toBeNull();
  });

  it('draws a soft wash for an item with no photo, and the photo when it has one', () => {
    show({ shown: enquiryLead });
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows the item’s photo when it has one', () => {
    show({ shown: { ...enquiryLead, itemPhotoUrl: 'https://files.example/items/cake.webp' } });
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://files.example/items/cake.webp');
  });

  it('says only "Ask for a price" with no starting price, and keeps a removed item’s name', () => {
    show({ shown: { ...enquiryLead, enquiry: { ...enquiryLead.enquiry!, item: { name: 'Custom birthday cake', photoKey: null, fromCents: null } } } });
    expect(screen.getByText('Ask for a price')).toBeInTheDocument();
  });

  it('keeps the item’s name from the first message once the item was removed', () => {
    show({ shown: { ...enquiryLead, enquiry: { ...enquiryLead.enquiry!, item: null } } });
    expect(screen.getByText('Custom birthday cake')).toBeInTheDocument();
    expect(screen.getByText('No longer in your shop')).toBeInTheDocument();
  });

  it('leaves out their name and message when they gave none', () => {
    show({ shown: { ...enquiryLead, enquiry: { ...enquiryLead.enquiry!, name: null, note: null } } });
    expect(screen.queryByText(/^Name:/)).toBeNull();
    expect(screen.queryByText('Their message')).toBeNull();
  });
});

describe('LeadDetail, the conversation', () => {
  it('is a row that says how long it was and when they left the number, not the chat itself', () => {
    show();
    const row = screen.getByRole('button', { name: /See the conversation/ });
    expect(row).toHaveTextContent('See the conversation3 messages · left their number at 1:35pm');
    // Not inline: nothing of the chat shows until the sheet opens.
    expect(screen.queryByText('nak tanya kek coklat 2kg berapa?')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'The conversation' })).toBeNull();
  });

  it('opens in the side sheet, with the number and when, the bubbles and where the number was left', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /See the conversation/ }));
    const open = screen.getByRole('dialog', { name: 'The conversation' });
    expect(open).toHaveTextContent('+60 12-781 4402 · Today, 1:30pm on your page');
    const lines = [...within(open).getByText('nak tanya kek coklat 2kg berapa?').parentElement!.children].map((line) => line.textContent);
    expect(lines).toEqual(['nak tanya kek coklat 2kg berapa?', 'Kek Lina’s pageKek coklat moist 2kg is RM170.', 'Left their number · 1:35pm', 'ok terima kasih']);
    expect(within(open).getByText('Only you see this.')).toBeInTheDocument();
  });

  it('closes from its Close pill', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /See the conversation/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'The conversation' })).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'The conversation' })).toBeNull();
    expect(screen.queryByText('nak tanya kek coklat 2kg berapa?')).toBeNull();
  });

  it('says when a long conversation is shown only in part', () => {
    show({ shown: { ...lead, messageCount: 75 } });
    expect(screen.getByRole('button', { name: /See the conversation/ })).toHaveTextContent('75 messages');
    fireEvent.click(screen.getByRole('button', { name: /See the conversation/ }));
    expect(screen.getByText('The first 3 of 75 messages.')).toBeInTheDocument();
  });

  it('has no "Left their number" in an enquiry’s, which came with its number', () => {
    show({ shown: enquiryLead });
    expect(screen.getByRole('button', { name: /See the conversation/ })).toHaveTextContent('2 messages · sent from your shop at 8:02am');
    fireEvent.click(screen.getByRole('button', { name: /See the conversation/ }));
    expect(screen.queryByText(/Left their number/)).toBeNull();
  });
});

describe('LeadDetail, reaching them', () => {
  it('drafts a first message on a new lead, to edit, and sends what was typed', () => {
    show();
    const box = screen.getByRole('textbox', { name: 'First message' });
    expect(box).toHaveValue('Hi! This is Kek Lina. You asked in the chat about kek coklat, 2kg, in Klang. Happy to help. When suits you to talk it through?');
    fireEvent.change(box, { target: { value: 'Hi! RM170 for 2kg.' } });
    expect(screen.getByRole('link', { name: 'Send on WhatsApp' })).toHaveAttribute('href', `https://wa.me/60127814402?text=${encodeURIComponent('Hi! RM170 for 2kg.')}`);
    expect(screen.getByText('Edit it before you send')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open WhatsApp' })).toBeNull();
  });

  it('marks a new lead contacted when it is sent', async () => {
    const { onStatus, say } = show();
    const send = screen.getByRole('link', { name: 'Send on WhatsApp' });
    send.addEventListener('click', (event) => event.preventDefault());
    await act(async () => {
      fireEvent.click(send);
    });
    expect(onStatus).toHaveBeenCalledWith('CONTACTED');
    expect(say).toHaveBeenCalledWith('WhatsApp opened. Marked contacted.');
  });

  it('keeps the first message after it was sent, with the done line in place of Send', () => {
    show({ status: 'CONTACTED', sent: true });
    expect(screen.getByRole('textbox', { name: 'First message' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'WhatsApp opened. Marked contacted.' })).toHaveAttribute('data-done');
    expect(screen.queryByRole('link', { name: 'Open WhatsApp' })).toBeNull();
  });

  it('keeps Send while the move to Contacted has not held', () => {
    show({ status: 'NEW', sent: true });
    expect(screen.getByRole('link', { name: 'Send on WhatsApp' })).not.toHaveAttribute('data-done');
  });

  it('tells the screen it was sent', () => {
    const onSent = vi.fn();
    show({ onSent });
    const send = screen.getByRole('link', { name: 'Send on WhatsApp' });
    send.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(send);
    expect(onSent).toHaveBeenCalled();
  });

  it.each(['CONTACTED', 'SOLD', 'CLOSED'] as const)('offers a %s lead Open WhatsApp in white, and no first message', async (status) => {
    const { onStatus, say } = show({ status });
    expect(screen.queryByRole('textbox')).toBeNull();
    const open = screen.getByRole('link', { name: 'Open WhatsApp' });
    expect(open).toHaveAttribute('href', 'https://wa.me/60127814402');
    open.addEventListener('click', (event) => event.preventDefault());
    await act(async () => {
      fireEvent.click(open);
    });
    expect(onStatus).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith('WhatsApp opened.');
  });

  it('copies the message', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    show();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Hi! This is Kek Lina.'));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('drafts an enquiry’s by their name and the item, in Malay for a Malay page', () => {
    show({ shown: enquiryLead, language: 'ms' });
    expect(screen.getByRole('textbox', { name: 'First message' })).toHaveValue(
      'Hai Farah! Ini Kek Lina. Terima kasih sebab bertanya tentang Custom birthday cake untuk Sun 15 Nov (20 people). Saya semak dulu, nanti saya bagi tahu harganya ya.',
    );
  });

  it('offers no "Send a quote": that waits for payment links', () => {
    show({ shown: enquiryLead });
    expect(screen.queryByRole('button', { name: /quote/i })).toBeNull();
  });
});

describe('LeadDetail, deleting', () => {
  it('says why it is there, and asks before deleting, in the board’s words', async () => {
    const { actions, onDeleted } = show();
    expect(screen.getByText('They agreed to be contacted when they left it. Delete it once you are done.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete lead' }));
    expect(actions.remove).not.toHaveBeenCalled();
    const confirm = screen.getByRole('group', { name: 'Delete lead' });
    expect(confirm).toHaveTextContent('Delete this number and the conversation with it? It cannot be brought back.');
    expect(within(confirm).getByRole('button', { name: 'Keep it' })).toHaveFocus();
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, delete' }));
    });
    expect(actions.remove).toHaveBeenCalledWith('l1');
    expect(onDeleted).toHaveBeenCalled();
  });

  it('keeps the confirm open and puts the reason in the error toast when deleting fails', async () => {
    const { onDeleted, fail, say } = show({ calls: { remove: vi.fn(async () => Promise.reject(new Error('No such lead.'))) } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete lead' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    });
    expect(onDeleted).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith('No such lead.');
    expect(say).not.toHaveBeenCalled();
    expect(screen.getByRole('group', { name: 'Delete lead' })).toBeInTheDocument();
  });
});
