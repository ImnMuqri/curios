import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { OwnerView as OwnerViewData } from '@curios/db-read/admin';
import { OwnerView } from './owner-view.js';

const view: OwnerViewData = {
  profile: {
    handle: 'keklina',
    displayName: 'Kek Lina',
    bio: 'Cakes in Shah Alam',
    mode: 'BUSINESS',
    language: 'en',
    published: true,
    links: [{ label: 'Instagram', url: 'https://instagram.com/keklina' }],
  },
  plan: {
    plan: 'Business',
    paidUntil: new Date('2026-11-14T03:00:00Z'),
    conversationsThisMonth: 164,
    cap: 200,
    leadsThisMonth: 9,
    ordersThisMonth: 14,
  },
  facts: [
    { text: 'Open Tuesday to Sunday', status: 'Live' },
    { text: 'Delivers to Klang', status: 'Pending' },
  ],
  items: [
    { name: 'Burnt cheesecake', priceCents: 8500, available: true },
    { name: 'Brownies', priceCents: null, available: false },
  ],
  leads: [{ maskedPhone: '+60••••••89', createdAt: new Date('2026-10-22T07:42:00Z'), slotsFilled: ['Date', 'Size'] }],
  orders: [
    { number: 12, maskedName: 'A. R.', totalCents: 19000, status: 'Paid', createdAt: new Date('2026-10-21T02:00:00Z') },
  ],
  conversations: { thisMonth: 164, latest: [new Date('2026-10-23T05:00:00Z')] },
};

describe('OwnerView', () => {
  it('names who is being viewed and says it is read only', () => {
    render(<OwnerView view={view} pageId="p1" />);

    expect(screen.getByText('Viewing Kek Lina as the owner · read only')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Pages' })).toHaveAttribute('href', '/pages?page=p1');
  });

  it('has every section', () => {
    render(<OwnerView view={view} pageId="p1" />);

    for (const name of ['Profile and links', 'Plan and usage', 'Facts', 'Items', 'Leads', 'Orders', 'Conversations']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Open Tuesday to Sunday')).toBeInTheDocument();
    expect(screen.getByText('Burnt cheesecake')).toBeInTheDocument();
    expect(screen.getByText('RM85')).toBeInTheDocument();
    expect(screen.getByText(/164 of 200 this month/)).toBeInTheDocument();
  });

  it('shows the masked phone and initials, never a whole number', () => {
    const { container } = render(<OwnerView view={view} pageId="p1" />);

    const leads = within(screen.getByRole('heading', { name: 'Leads' }).closest('section') as HTMLElement);
    expect(leads.getByText('+60••••••89')).toBeInTheDocument();
    expect(screen.getByText(/#12 · A\. R\./)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\+?\d{9,}/);
  });

  it('shows conversations as a count and times, with no message text', () => {
    render(<OwnerView view={view} pageId="p1" />);

    const chats = within(screen.getByRole('heading', { name: 'Conversations' }).closest('section') as HTMLElement);
    expect(chats.getByText('164')).toBeInTheDocument();
    expect(chats.getByText('23 Oct 2026, 1:00pm')).toBeInTheDocument();
  });

  it('has no button, only navigation', () => {
    render(<OwnerView view={view} pageId="p1" />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });
});
