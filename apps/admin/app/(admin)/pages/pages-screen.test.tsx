import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminPageRow } from '@curios/db-read/admin';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

import { PagesScreen, pagesHref } from './pages-screen.js';

const rows: AdminPageRow[] = [
  {
    id: 'p1',
    handle: 'keklina',
    displayName: 'Kek Lina',
    mode: 'BUSINESS',
    status: 'Live',
    ownerEmail: 'lina@keklina.example',
    createdAt: new Date('2026-09-02T03:00:00Z'),
    plan: 'Business',
    paidUntil: new Date('2026-11-14T03:00:00Z'),
    conversationsThisMonth: 164,
    cap: 200,
    leadsThisMonth: 9,
    ordersThisMonth: 14,
  },
  {
    id: 'p2',
    handle: 'danieltan',
    displayName: 'Daniel Tan',
    mode: 'PERSONAL',
    status: 'Suspended',
    ownerEmail: 'daniel@mail.example',
    createdAt: new Date('2026-10-11T03:00:00Z'),
    plan: 'Personal',
    paidUntil: null,
    conversationsThisMonth: 41,
    cap: 200,
    leadsThisMonth: 0,
    ordersThisMonth: 0,
  },
];

const base = { rows, q: '', filter: 'all' as const, detail: null, appUrl: 'http://localhost:3000' };

beforeEach(() => push.mockClear());

describe('PagesScreen', () => {
  it('draws the board columns and each row figures', () => {
    render(<PagesScreen {...base} />);

    const table = screen.getByRole('table', { name: 'Pages' });
    const heads = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(['Page', 'Plan', 'Paid until', 'Conversations', 'Leads', 'Orders', 'Status']);

    const [, lina, daniel] = within(table).getAllByRole('row');
    const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent);
    expect(cells(lina!)).toEqual(['Kek Linacurios.my/keklina', 'Business', '14 Nov 2026', '164', '9', '14', 'Live']);
    expect(cells(daniel!)).toEqual(['Daniel Tancurios.my/danieltan', 'Personal', '-', '41', '0', '0', 'Suspended']);
    expect(within(table).queryByText('lina@keklina.example')).not.toBeInTheDocument();
  });

  it('has the five filter chips, each one a link to its filter', () => {
    render(<PagesScreen {...base} q="lina" filter="business" />);

    const chips = within(screen.getByRole('navigation', { name: 'Filter pages' }));
    expect(chips.getByRole('link', { name: 'All' })).toHaveAttribute('href', '/pages?q=lina');
    expect(chips.getByRole('link', { name: 'Business' })).toHaveAttribute('href', '/pages?q=lina&filter=business');
    expect(chips.getByRole('link', { name: 'Personal' })).toHaveAttribute('href', '/pages?q=lina&filter=personal');
    expect(chips.getByRole('link', { name: 'Lapsed' })).toHaveAttribute('href', '/pages?q=lina&filter=lapsed');
    expect(chips.getByRole('link', { name: 'Hidden or suspended' })).toHaveAttribute(
      'href',
      '/pages?q=lina&filter=flagged',
    );
    expect(chips.getByRole('link', { name: 'Business' })).toHaveAttribute('aria-current', 'true');
  });

  it('searching puts the text in the URL and keeps the filter', async () => {
    render(<PagesScreen {...base} filter="personal" />);

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search pages' }), 'kek{Enter}');

    expect(push).toHaveBeenCalledWith('/pages?q=kek&filter=personal');
  });

  it('clicking a row opens its panel by ?page=', async () => {
    render(<PagesScreen {...base} q="a" />);

    await userEvent.click(screen.getByText('curios.my/keklina'));

    expect(push).toHaveBeenCalledWith('/pages?q=a&page=p1');
  });

  it('says so when nothing matches', () => {
    render(<PagesScreen {...base} rows={[]} q="zzz" />);

    expect(screen.getByText('No pages match “zzz”.')).toBeInTheDocument();
  });

  it('builds addresses without empty parts', () => {
    expect(pagesHref({})).toBe('/pages');
    expect(pagesHref({ filter: 'all' })).toBe('/pages');
    expect(pagesHref({ filter: 'flagged', page: 'x' })).toBe('/pages?filter=flagged&page=x');
  });
});
