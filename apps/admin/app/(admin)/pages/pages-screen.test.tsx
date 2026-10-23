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
  },
  {
    id: 'p2',
    handle: 'danieltan',
    displayName: 'Daniel Tan',
    mode: 'PERSONAL',
    status: 'Suspended',
    ownerEmail: 'daniel@mail.example',
    createdAt: new Date('2026-10-11T03:00:00Z'),
  },
];

const base = { rows, q: '', filter: 'all' as const, detail: null, appUrl: 'http://localhost:3000' };

beforeEach(() => push.mockClear());

describe('PagesScreen', () => {
  it('lists the pages with kind, created and status', () => {
    render(<PagesScreen {...base} />);

    const table = screen.getByRole('table', { name: 'Pages' });
    expect(within(table).getByText('Kek Lina')).toBeInTheDocument();
    expect(within(table).getByText('curios.my/keklina')).toBeInTheDocument();
    expect(within(table).getByText('lina@keklina.example')).toBeInTheDocument();
    expect(within(table).getByText('2 Sep 2026')).toBeInTheDocument();
    expect(within(table).getByText('Suspended')).toBeInTheDocument();
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

    await userEvent.click(screen.getByText('lina@keklina.example'));

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
