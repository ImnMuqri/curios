import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Alert } from '../alerts.js';

let pathname = '/app/leads';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
const { AlertSlot, AlertsProvider, pickAlert } = await import('./alert-slot.js');

const trial: Alert = {
  id: 'trial-1',
  tone: 'info',
  where: '/app/leads',
  icon: 'lead',
  title: '1 of your 3 free leads used',
  text: 'After 3, the capture card stops appearing on your page until you subscribe.',
  meter: [true, false, false],
  action: { href: '/app/billing', label: 'See plans' },
};
const ended: Alert = { ...trial, id: 'lapsed-2026-10-14', tone: 'stop', where: 'all', icon: 'card', title: 'Your Business plan ended on 14 Oct 2026', action: { href: '/app/billing', label: 'Renew your plan' } };

const slot = (alerts: Alert[]) =>
  render(
    <AlertsProvider alerts={alerts}>
      <AlertSlot />
    </AlertsProvider>,
  );

describe('pickAlert', () => {
  it('shows an every-screen alert first, then the one about this screen, and nothing elsewhere', () => {
    expect(pickAlert([trial, ended], '/app/leads')).toBe(ended);
    expect(pickAlert([trial], '/app/leads')).toBe(trial);
    expect(pickAlert([trial], '/app/questions')).toBeNull();
  });

  it('puts a stop alert about this screen before the every-screen one: Orders says checkout is paused', () => {
    const paused: Alert = {
      ...ended,
      id: 'paused-2026-10-13',
      where: '/app/orders',
      icon: 'shop',
      title: 'Your shop can’t take orders right now',
      text: 'Your Business plan ended on 14 Oct 2026. Customers can still see your shop, and their basket comes to you on WhatsApp instead.',
    };
    expect(pickAlert([ended, paused], '/app/orders')).toBe(paused);
    expect(pickAlert([ended, paused], '/app/leads')).toBe(ended);
    expect(pickAlert([ended, paused], '/app/curios')).toBe(ended);
    // A blue one about the screen does not push a red every-screen one aside.
    expect(pickAlert([ended, { ...trial, where: '/app/orders' }], '/app/orders')).toBe(ended);
  });
});

describe('AlertSlot', () => {
  beforeEach(() => {
    window.localStorage.clear();
    pathname = '/app/leads';
  });

  it('shows the screen’s alert with its way forward', () => {
    slot([trial]);
    expect(screen.getByRole('status')).toHaveTextContent('1 of your 3 free leads used');
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/app/billing');
  });

  it('lets a blue one be dismissed, and remembers it', async () => {
    slot([trial]);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(window.localStorage.getItem('curios:alert-dismissed:trial-1')).toBe('1');
  });

  it('stays dismissed on the next visit', () => {
    window.localStorage.setItem('curios:alert-dismissed:trial-1', '1');
    slot([trial]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('gives a red one no way to dismiss it, and says it as an alert', () => {
    slot([ended]);
    expect(screen.getByRole('alert')).toHaveTextContent('Your Business plan ended on 14 Oct 2026');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('shows a paused shop on Orders, in red, with the way to pay', () => {
    pathname = '/app/orders';
    const paused: Alert = {
      id: 'paused',
      tone: 'stop',
      where: '/app/orders',
      icon: 'shop',
      title: 'Your shop can’t take orders right now',
      text: 'Your 3 free orders are used. Customers can still see your shop, and their basket comes to you on WhatsApp instead.',
      action: { href: '/app/billing', label: 'Pay to take orders' },
    };
    slot([trial, paused]);
    expect(screen.getByRole('alert')).toHaveTextContent('Your shop can’t take orders right now');
    expect(screen.getByRole('link', { name: 'Pay to take orders' })).toHaveAttribute('href', '/app/billing');
    expect(screen.queryByText('1 of your 3 free leads used')).toBeNull();
  });

  it('tells a lapsed open shop on Orders that checkout is paused, and every other screen that the plan ended', async () => {
    const { alertsFor } = await import('../alerts.js');
    const { orderState, planState } = await import('@curios/core');
    const now = new Date('2026-10-15T04:00:00.000Z');
    const row = { mode: 'BUSINESS' as const, paidUntil: new Date('2026-10-13T20:00:00.000Z'), now };
    const alerts = alertsFor({
      plan: planState({ ...row, leadsCaptured: 1 }),
      usage: { used: 0, cap: 200 },
      now,
      orders: { state: orderState({ ...row, ordersPlaced: 3, ordersAtTrialReset: 0 }), storeEnabled: true },
    });

    pathname = '/app/orders';
    const { unmount } = slot(alerts);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your shop can’t take orders right nowYour Business plan ended on 14 Oct 2026. Customers can still see your shop, and their basket comes to you on WhatsApp instead.',
    );
    unmount();

    pathname = '/app/leads';
    slot(alerts);
    expect(screen.getByRole('alert')).toHaveTextContent('Your Business plan ended on 14 Oct 2026');
    expect(screen.queryByText(/can’t take orders/)).toBeNull();
  });

  it('shows nothing outside the frame', () => {
    render(<AlertSlot />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
