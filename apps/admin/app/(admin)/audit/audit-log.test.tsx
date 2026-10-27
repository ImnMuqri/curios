import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AuditRow } from '@curios/db-read/admin';
import { AuditLog, AUDIT_PAGE_SIZE, actionLabel, when } from './audit-log.js';

const row = (n: number, over: Partial<AuditRow> = {}): AuditRow => ({
  id: `a${n}`,
  createdAt: new Date(Date.UTC(2026, 9, 20, 14, 31) - n * 60_000),
  adminName: 'Iman',
  action: 'SUSPENDED_PAGE',
  targetType: 'Page',
  targetId: `p${n}`,
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
    expect(actionLabel('DISMISSED_REPORTS')).toBe('Dismissed reports');
    expect(actionLabel('EMAILED_OWNER')).toBe('Emailed the owner about a report');
    expect(actionLabel('REPLAYED_WEBHOOK')).toBe('Replayed a payment webhook');
    expect(actionLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('words a switch from its key, with the switch’s title in lower case', () => {
    expect(actionLabel('TURNED_OFF', 'chat')).toBe('Turned off chat answers');
    expect(actionLabel('TURNED_ON', 'signups')).toBe('Turned on new sign-ups');
    expect(actionLabel('TURNED_OFF', 'reading')).toBe('Turned off reading new sources');
    expect(actionLabel('TURNED_OFF', 'chipPayments')).toBe('Turned off online payments (CHIP)');
    expect(actionLabel('TURNED_OFF', 'ownerEmails')).toBe('Turned off emails to owners');
    expect(actionLabel('TURNED_OFF', 'mystery')).toBe('Turned off a switch');
  });

  it('labels the limits and the banner', () => {
    expect(actionLabel('CHANGED_LIMITS', 'limits')).toBe('Changed limits and prices');
    expect(actionLabel('SHOWED_BANNER', 'banner')).toBe('Showed a banner to all owners');
    expect(actionLabel('TOOK_BANNER_DOWN', 'banner')).toBe('Took the banner down');
  });

  it('shows a setting change against everyone, not a page address', () => {
    render(<AuditLog paged={false} rows={[row(1, { action: 'TURNED_OFF', targetId: 'chat', targetLabel: 'chat', reason: 'Outage' })]} />);
    const r = screen.getAllByRole('row')[1]!;
    expect(within(r).getByText('Turned off chat answers')).toBeTruthy();
    expect(within(r).getByText('everyone')).toBeTruthy();
  });

  it('words a source retry, and shows retrying all against everyone', () => {
    expect(actionLabel('RETRIED_SOURCE')).toBe('Retried a source');
    expect(actionLabel('RETRIED_FAILED_SOURCES')).toBe('Retried all failed sources');
    render(
      <AuditLog
        paged={false}
        rows={[row(1, { action: 'RETRIED_FAILED_SOURCES', targetType: 'Source', targetId: 'failed', targetLabel: 'everyone' })]}
      />,
    );
    const r = screen.getAllByRole('row')[1]!;
    expect(within(r).getByText('everyone')).toBeTruthy();
    expect(screen.queryByText('curios.my/everyone')).toBeNull();
  });

  it('shows a payment replay against the page when it has one, and as the plain label when it labels a purchase', () => {
    render(
      <AuditLog
        paged={false}
        rows={[
          row(1, { action: 'REPLAYED_WEBHOOK', targetType: 'Payment', targetId: 'pay1', targetLabel: 'studiohana' }),
          row(2, { action: 'REPLAYED_WEBHOOK', targetType: 'Payment', targetId: 'pay2', targetLabel: '0c9b6a5e-1d2f-4b8a-9a43-7f1e5d2c8b10' }),
          row(3, { action: 'REPLAYED_WEBHOOK', targetType: 'Payment', targetId: 'CHIP-8QT9', targetLabel: 'CHIP-8QT9' }),
        ]}
      />,
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('curios.my/studiohana')).toBeTruthy();
    expect(within(rows[1]!).getByText('0c9b6a5e-1d2f-4b8a-9a43-7f1e5d2c8b10')).toBeTruthy();
    expect(within(rows[2]!).getByText('CHIP-8QT9')).toBeTruthy();
    expect(screen.queryByText(/curios\.my\/0c9b/)).toBeNull();
    expect(screen.queryByText('curios.my/CHIP-8QT9')).toBeNull();
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
