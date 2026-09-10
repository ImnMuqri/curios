import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { OwnerLead } from '@curios/db-read';
import { LeadList } from './lead-list.js';

const leads: OwnerLead[] = [
  {
    id: 'l1',
    phone: '+60123456789',
    score: 2,
    slots: { product: 'kek butter 2kg', date: null, location: 'Klang' },
    status: 'NEW',
    createdAt: new Date('2026-09-05T10:00:00Z'),
    transcript: [
      { role: 'USER', content: 'nak kek butter 2kg' },
      { role: 'ASSISTANT', content: 'RM160 untuk 2kg.' },
    ],
  },
];

describe('LeadList', () => {
  it('shows the number, because that is what the owner came for', () => {
    render(<LeadList leads={leads} onDelete={vi.fn()} />);
    expect(screen.getByText('+60123456789')).toBeInTheDocument();
  });

  it('offers a WhatsApp link that opens on the right number', () => {
    // Digits only, no plus. The same rule the notification learned: a wa.me
    // link carrying a plus opens WhatsApp on a broken number.
    render(<LeadList leads={leads} onDelete={vi.fn()} />);
    expect(screen.getByRole('link', { name: /whatsapp/i })).toHaveAttribute(
      'href',
      expect.stringContaining('https://wa.me/60123456789'),
    );
  });

  it('keeps the transcript closed until asked', () => {
    // The list is for scanning. A dozen transcripts open at once is not a
    // list, and the point of the drawer is reading one against its number.
    render(<LeadList leads={leads} onDelete={vi.fn()} />);
    expect(screen.queryByText('nak kek butter 2kg')).not.toBeInTheDocument();
  });

  it('opens the transcript on request', async () => {
    render(<LeadList leads={leads} onDelete={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /transcript/i }));
    expect(screen.getByText('nak kek butter 2kg')).toBeInTheDocument();
  });

  it('shows what the customer asked for when extraction found it', () => {
    render(<LeadList leads={leads} onDelete={vi.fn()} />);
    expect(screen.getByText(/kek butter 2kg/)).toBeInTheDocument();
  });

  it('renders a lead whose extraction found nothing', () => {
    // slots is null when the job failed, which slice 4 deliberately allows.
    // A screen that needs slots to render would lose the lead entirely.
    const bare: OwnerLead[] = [{ ...leads[0]!, id: 'l2', slots: null, score: 0 }];
    render(<LeadList leads={bare} onDelete={vi.fn()} />);
    expect(screen.getByText('+60123456789')).toBeInTheDocument();
  });

  it('asks before deleting', async () => {
    // A phone number is the one thing on this screen that cannot be recovered
    // by reloading. One misplaced tap should not destroy it.
    const onDelete = vi.fn();
    render(<LeadList leads={leads} onDelete={onDelete} />);

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(onDelete).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));
    expect(onDelete).toHaveBeenCalledWith('l1');
  });

  it('says what failed when a delete does not land', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('That failed. Try again.'));
    render(<LeadList leads={leads} onDelete={onDelete} />);

    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await userEvent.click(screen.getByRole('button', { name: /yes, delete/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/try again/i);
  });

  it('says what to do when there are none yet', () => {
    render(<LeadList leads={[]} onDelete={vi.fn()} />);
    expect(screen.getByText(/share your link/i)).toBeInTheDocument();
  });
});
