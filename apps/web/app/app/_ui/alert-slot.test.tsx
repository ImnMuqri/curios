import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FREE_LEADS, FREE_ORDERS, orderState, planState } from '@curios/core';
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

describe('a suspended page', () => {
  const suspended: Alert = { ...ended, id: 'suspended', icon: 'page', title: 'Your page is suspended', text: 'Scam reports', action: { href: 'mailto:support@curios.my', label: 'Contact support' } };

  it('wins on every screen, even over a red alert about that screen', () => {
    const paused: Alert = { ...ended, id: 'paused', where: '/app/orders', icon: 'shop' };
    expect(pickAlert([suspended, paused], '/app/orders')).toBe(suspended);
    expect(pickAlert([suspended], '/app/curios')).toBe(suspended);
  });

  it('renders with its reason and a support link', () => {
    pathname = '/app/curios';
    slot([suspended]);
    expect(screen.getByText('Your page is suspended')).toBeInTheDocument();
    expect(screen.getByText('Scam reports')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', 'mailto:support@curios.my');
  });
});

describe('the Curios team’s banner', () => {
  const banner: Alert = { id: 'banner', tone: 'info', where: 'all', icon: 'chat', title: 'From the Curios team', text: 'Payments are slow this morning.', fixed: true };

  it('wins on every screen, over a red alert and a suspension', () => {
    const suspended: Alert = { ...ended, id: 'suspended' };
    expect(pickAlert([banner, ended, trial], '/app/leads')).toBe(banner);
    expect(pickAlert([banner, suspended], '/app/curios')).toBe(banner);
  });

  it('has no link and no way to dismiss, and stays even if an old dismissal is stored', () => {
    window.localStorage.setItem('curios:alert-dismissed:banner', '1');
    pathname = '/app/curios';
    slot([banner]);
    expect(screen.getByRole('status')).toHaveTextContent('From the Curios teamPayments are slow this morning.');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

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
    const { FREE_LEADS, FREE_ORDERS, orderState, planState } = await import('@curios/core');
    const now = new Date('2026-10-15T04:00:00.000Z');
    const row = { mode: 'BUSINESS' as const, paidUntil: new Date('2026-10-13T20:00:00.000Z'), now };
    const alerts = alertsFor({
      plan: planState({ ...row, leadsCaptured: 1 }),
      usage: { used: 0, cap: 200 },
      now,
      orders: { state: orderState({ ...row, ordersPlaced: 3, ordersAtTrialReset: 0 }), storeEnabled: true },
      freeLeads: FREE_LEADS,
      freeOrders: FREE_ORDERS,
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

describe('the plan banners', () => {
  const NOW = new Date('2026-10-15T04:00:00.000Z');
  const BIZ = { mode: 'BUSINESS' as const, now: NOW };
  const rows = [
    { name: '2 of 3 free leads used', path: '/app/leads', tone: 'info', title: '2 of your 3 free leads used', button: 'See plans', input: { plan: planState({ ...BIZ, paidUntil: null, leadsCaptured: 2 }), usage: { used: 10, cap: 200 } } },
    { name: 'free leads used', path: '/app/leads', tone: 'warn', title: 'Your 3 free leads are used', button: 'See your options', input: { plan: planState({ ...BIZ, paidUntil: null, leadsCaptured: 3 }), usage: { used: 10, cap: 200 } } },
    { name: 'near the chat limit', path: '/app/questions', tone: 'warn', title: '164 of 200 conversations used this month', button: 'See usage', input: { plan: planState({ mode: 'PERSONAL', paidUntil: null, leadsCaptured: 0, now: NOW }), usage: { used: 164, cap: 200 } } },
    {
      name: 'free orders used',
      path: '/app/orders',
      tone: 'stop',
      title: 'Your shop can’t take orders right now',
      button: 'Pay to take orders',
      input: {
        plan: planState({ ...BIZ, paidUntil: null, leadsCaptured: 0 }),
        usage: { used: 10, cap: 200 },
        orders: { state: orderState({ ...BIZ, paidUntil: null, ordersPlaced: 3, ordersAtTrialReset: 0 }), storeEnabled: true },
      },
    },
    { name: 'plan ended', path: '/app/billing', tone: 'stop', title: 'Your Business plan ended on 14 Oct 2026', button: 'Renew your plan', input: { plan: planState({ ...BIZ, paidUntil: new Date('2026-10-13T20:00:00.000Z'), leadsCaptured: 3 }), usage: { used: 10, cap: 200 } } },
  ] as const;

  it.each(rows)('maps each plan state to its banner tone: $name', async (row) => {
    pathname = row.path;
    window.localStorage.clear();
    const { alertsFor } = await import('../alerts.js');
    const { container } = slot(alertsFor({ now: NOW, freeLeads: FREE_LEADS, freeOrders: FREE_ORDERS, ...row.input }));
    const banner = container.querySelector('[data-tone]');
    expect(banner).toHaveAttribute('data-tone', row.tone);
    expect(banner).toHaveTextContent(row.title);
    expect(screen.getByRole('link', { name: row.button })).toHaveAttribute('href', '/app/billing');
  });

  it('puts the tone on the Curios team’s banner (info) and a suspension (stop)', () => {
    pathname = '/app/curios';
    const team: Alert = { id: 'banner', tone: 'info', where: 'all', icon: 'chat', title: 'From the Curios team', text: 'Hello.', fixed: true };
    const { container, unmount } = slot([team]);
    expect(container.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'info');
    unmount();
    const { container: c2 } = slot([{ ...ended, id: 'suspended', icon: 'page' }]);
    expect(c2.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'stop');
  });

  it('dismisses with a named × and remembers it', async () => {
    pathname = '/app/leads';
    window.localStorage.clear();
    const { container } = slot([trial]);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(container.querySelector('[data-tone]')).toBeNull();
    expect(window.localStorage.getItem('curios:alert-dismissed:trial-1')).toBe('1');
  });
});

describe('the banner’s ×, role and badge', () => {
  const base: Alert = { id: 'x-1', tone: 'info', where: '/app/leads', icon: 'lead', title: 'T', text: 'L', action: { href: '/app/billing', label: 'Go' } };
  it.each([
    { tone: 'info', fixed: false, x: true, role: 'status' },
    { tone: 'warn', fixed: false, x: true, role: 'status' },
    { tone: 'stop', fixed: false, x: false, role: 'alert' },
    { tone: 'info', fixed: true, x: false, role: 'status' },
  ] as const)('$tone (fixed $fixed): × $x, role $role', ({ tone, fixed, x, role }) => {
    pathname = '/app/leads';
    window.localStorage.clear();
    slot([{ ...base, tone, fixed }]);
    expect(screen.getByRole(role)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' }) !== null).toBe(x);
  });

  it('shows the count on the leads and near-limit banners, and an icon elsewhere', async () => {
    const { alertsFor } = await import('../alerts.js');
    const NOW = new Date('2026-10-15T04:00:00.000Z');
    const mk = (leads: number, used: number) =>
      alertsFor({ plan: planState({ mode: 'BUSINESS', paidUntil: null, leadsCaptured: leads, now: NOW }), usage: { used, cap: 200 }, now: NOW, freeLeads: FREE_LEADS, freeOrders: FREE_ORDERS });
    pathname = '/app/leads';
    const a = slot(mk(2, 10));
    expect(a.container.querySelector('[data-tone]')).toHaveTextContent('2/3');
    a.unmount();
    pathname = '/app/questions';
    const b = slot(mk(0, 164));
    expect(b.container.querySelector('[data-tone]')).toHaveTextContent('164');
    b.unmount();
    pathname = '/app/leads';
    const c = slot(mk(3, 10));
    expect(c.container.querySelector('svg')).not.toBeNull();
  });
});
