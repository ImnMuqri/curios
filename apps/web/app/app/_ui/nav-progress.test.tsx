import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

let pathname = '/app/curios';
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useSearchParams: () => new URLSearchParams() }));
const { NavProgress, NavProgressProvider } = await import('./nav-progress.js');

const ui = () => (
  <NavProgressProvider>
    <header data-testid="head">
      <NavProgress />
    </header>
    <a href="/app/leads">Leads</a>
    <a href="/app/curios">My Curios</a>
    <a href="https://example.com/app/x">Elsewhere</a>
  </NavProgressProvider>
);
// The links would navigate jsdom; the bar only needs the click to reach the document.
const click = (name: string, init: MouseEventInit = {}) => {
  const link = screen.getByRole('link', { name });
  link.addEventListener('click', (event) => event.preventDefault(), { once: true });
  fireEvent.click(link, init);
};
const bar = () => screen.getByTestId('head').querySelector('[data-phase]');

describe('NavProgress', () => {
  afterEach(() => {
    pathname = '/app/curios';
    vi.useRealTimers();
  });

  it('runs from a click on another dashboard screen until that screen arrives, then fades', () => {
    vi.useFakeTimers();
    const { rerender } = render(ui());
    expect(bar()).toBeNull();

    click('Leads');
    expect(bar()).toHaveAttribute('data-phase', 'loading');

    pathname = '/app/leads';
    rerender(ui());
    expect(bar()).toHaveAttribute('data-phase', 'done');
    act(() => { vi.advanceTimersByTime(400); });
    expect(bar()).toBeNull();
  });

  it('stays still for the screen already open, a new tab, and another site', () => {
    render(ui());
    click('My Curios');
    click('Leads', { ctrlKey: true });
    click('Elsewhere');
    expect(bar()).toBeNull();
  });

  it('gives up on a screen that never arrives', () => {
    vi.useFakeTimers();
    render(ui());
    click('Leads');
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(bar()).toBeNull();
  });
});
