import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { OwnerLead } from '@curios/db-read';
import { LeadDetail, type LeadActions } from './lead-detail.js';

const lead: OwnerLead = {
  id: 'l1',
  phone: '+60127814402',
  score: 2,
  slots: { product: 'Kek coklat, 2kg', date: null, location: 'Klang' },
  status: 'NEW',
  createdAt: new Date('2026-10-17T05:35:00Z'),
  transcript: [
    { role: 'USER', content: 'nak tanya kek coklat 2kg berapa?' },
    { role: 'ASSISTANT', content: 'Kek coklat moist 2kg is RM170.' },
  ],
};

function show(calls: Partial<LeadActions> = {}) {
  const actions: LeadActions = { setStatus: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), ...calls };
  const onDeleted = vi.fn();
  const say = vi.fn();
  render(
    <LeadDetail
      lead={lead}
      status="NEW"
      handle="keklina"
      displayName="Kek Lina"
      language="en"
      look={{ accentColor: '#b5294e', headingFont: 'FRAUNCES', background: 'INK', backgroundColor: null }}
      now={new Date('2026-10-17T06:00:00Z')}
      actions={actions}
      onStatus={vi.fn(async () => undefined)}
      onDeleted={onDeleted}
      say={say}
    />,
  );
  return { actions, onDeleted, say };
}

describe('LeadDetail', () => {
  it('says who left the number, when, and where', () => {
    show();
    expect(screen.getByRole('heading', { name: '+60 12-781 4402' })).toBeInTheDocument();
    expect(screen.getByText('Left their number 25 min ago · in the chat on curios.my/keklina')).toBeInTheDocument();
  });

  it('shows what they are after, what is missing, and how ready they are', () => {
    show();
    expect(screen.getByText('Kek coklat, 2kg')).toBeInTheDocument();
    expect(screen.getByText('Not mentioned')).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.getByText('Almost there')).toBeInTheDocument();
  });

  it('shows the conversation, ending where they left their number', () => {
    show();
    const convo = within(screen.getByLabelText('The conversation'));
    expect(convo.getByText('nak tanya kek coklat 2kg berapa?')).toBeInTheDocument();
    expect(convo.getByText('Left their number')).toBeInTheDocument();
    expect(screen.getByText('2 messages')).toBeInTheDocument();
  });

  it('drafts a first message to edit, and sends what was typed', () => {
    show();
    const box = screen.getByRole('textbox', { name: 'WhatsApp message' });
    expect(box).toHaveValue('Hi! This is Kek Lina. You asked in the chat about kek coklat, 2kg, in Klang. Happy to help. When suits you to talk it through?');
    fireEvent.change(box, { target: { value: 'Hi! RM170 for 2kg.' } });
    expect(screen.getByText('18 characters')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send on WhatsApp' })).toHaveAttribute('href', `https://wa.me/60127814402?text=${encodeURIComponent('Hi! RM170 for 2kg.')}`);
  });

  it('copies the message', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    show();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Hi! This is Kek Lina.'));
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('deletes only after confirming', async () => {
    const { actions, onDeleted } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete lead' }));
    expect(actions.remove).not.toHaveBeenCalled();
    const confirm = screen.getByRole('group', { name: 'Confirm deleting this lead' });
    expect(confirm).toHaveTextContent('Delete this number? It cannot be brought back.');
    await act(async () => { fireEvent.click(within(confirm).getByRole('button', { name: 'Yes, delete' })); });
    expect(actions.remove).toHaveBeenCalledWith('l1');
    expect(onDeleted).toHaveBeenCalled();
  });

  it('keeps the confirm open, with the reason, when deleting fails', async () => {
    const { onDeleted } = show({ remove: vi.fn(async () => { throw new Error('No such lead.'); }) });
    fireEvent.click(screen.getByRole('button', { name: 'Delete lead' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' })); });
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('No such lead.');
    expect(screen.getByRole('group', { name: 'Confirm deleting this lead' })).toBeInTheDocument();
  });
});
