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

  it('shows nothing outside the frame', () => {
    render(<AlertSlot />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
