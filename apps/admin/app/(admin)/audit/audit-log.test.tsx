import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AuditRow } from '@curios/db-read/admin';
import { AuditLog, AUDIT_PAGE_SIZE, actionLabel, when } from './audit-log.js';

const row = (n: number, over: Partial<AuditRow> = {}): AuditRow => ({
  id: `a${n}`,
  createdAt: new Date(Date.UTC(2026, 9, 20, 14, 31) - n * 60_000),
  adminName: 'Iman',
  action: 'SUSPENDED_PAGE',
  targetLabel: `page${n}`,
  reason: `Reason ${n}`,
  ...over,
});

describe('AuditLog', () => {
  it('formats a time on the Malaysian clock', () => {
    expect(when(new Date('2026-10-20T14:31:00Z'))).toBe('20 Oct 22:31');
    expect(when(new Date('2026-10-20T16:05:00Z'))).toBe('21 Oct 00:05');
  });

  it('labels each action and falls back to the raw string', () => {
    expect(actionLabel('GRANTED_MONTH')).toBe('Gave one month of Business');
    expect(actionLabel('VIEWED_AS_OWNER')).toBe('Saw the page as the owner');
    expect(actionLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('renders rows in the order given with readable labels, page and reason', () => {
    render(
      <AuditLog
        paged={false}
        rows={[
          row(1, { action: 'GRANTED_MONTH' }),
          row(2),
          row(3, { action: 'SIGNED_IN', targetLabel: 'a@b.my', reason: 'Signed in' }),
        ]}
      />,
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('Gave one month of Business')).toBeTruthy();
    expect(within(rows[0]!).getByText('curios.my/page1')).toBeTruthy();
    expect(within(rows[0]!).getByText('20 Oct 22:30')).toBeTruthy();
    expect(within(rows[0]!).getByText('Reason 1')).toBeTruthy();
    expect(within(rows[1]!).getByText('Suspended the page')).toBeTruthy();
    expect(within(rows[2]!).getByText('everyone')).toBeTruthy();
    expect(screen.queryByText('a@b.my')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Older' })).toBeNull();
  });

  it('Older carries the last row time when a full page came back', () => {
    const rows = Array.from({ length: AUDIT_PAGE_SIZE }, (_, i) => row(i + 1));
    render(<AuditLog rows={rows} paged={false} />);
    const href = screen.getByRole('link', { name: 'Older' }).getAttribute('href');
    expect(href).toBe(`/audit?before=${encodeURIComponent(rows[rows.length - 1]!.createdAt.toISOString())}`);
  });

  it('offers Newest on an older page', () => {
    render(<AuditLog rows={[row(1)]} paged />);
    expect(screen.getByRole('link', { name: 'Newest' }).getAttribute('href')).toBe('/audit');
  });
});
