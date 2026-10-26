import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { NavBadges } from '@curios/db-read';
import { parseTheme, THEME_COOKIE, type Theme } from './theme.js';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/curios', useSearchParams: () => new URLSearchParams() }));
const { AppFrame } = await import('./app-frame.js');
const { PageHead } = await import('./_ui/page-head.js');

const frame = ({
  badges = { review: 3, questions: 0, leads: 0, orders: 0 },
  mode = 'PERSONAL',
  avatarUrl = null,
  billingDot = false,
}: { badges?: NavBadges; mode?: 'PERSONAL' | 'BUSINESS'; avatarUrl?: string | null; billingDot?: boolean } = {}) =>
  render(
    <AppFrame displayName="Iman Muqri" avatarUrl={avatarUrl} planLabel="Personal page" badges={badges} mode={mode} billingDot={billingDot}>
      <p>content</p>
    </AppFrame>,
  );

const links = () => within(screen.getByRole('navigation', { name: 'Dashboard' })).getAllByRole('link');

describe('AppFrame', () => {
  it('groups the modules as Page, Inbox, Knowledge and Account', () => {
    frame();
    expect(links().map((a) => a.textContent)).toEqual([
      'My Curios',
      'Questions',
      'Leads',
      'Review3',
      'Facts & sources',
      'Billing',
      'Settings',
    ]);
    const nav = screen.getByRole('navigation', { name: 'Dashboard' });
    expect(['Page', 'Inbox', 'Knowledge', 'Account'].map((group) => within(nav).getByText(group))).toHaveLength(4);
  });

  it('shows a business page a Store link, after My Curios', () => {
    frame({ mode: 'BUSINESS' });
    expect(screen.getByRole('link', { name: 'Store' })).toHaveAttribute('href', '/app/store');
    expect(links().map((a) => a.textContent).slice(0, 2)).toEqual(['My Curios', 'Store']);
  });

  it('shows a personal page no Store link', () => {
    frame({ mode: 'PERSONAL' });
    expect(screen.queryByRole('link', { name: 'Store' })).toBeNull();
  });

  it('puts Orders first in the Inbox for a business page, counting the receipts to check', () => {
    frame({ mode: 'BUSINESS', badges: { review: 0, questions: 0, leads: 0, orders: 2 } });
    expect(screen.getByRole('link', { name: /^Orders/ })).toHaveAttribute('href', '/app/orders');
    expect(links().map((a) => a.textContent).slice(2, 5)).toEqual(['Orders2', 'Questions', 'Leads']);
  });

  it('shows a personal page no Orders link, whatever the count says', () => {
    frame({ mode: 'PERSONAL', badges: { review: 0, questions: 0, leads: 0, orders: 2 } });
    expect(screen.queryByRole('link', { name: /Orders/ })).toBeNull();
  });

  it('sends Facts & sources to the Knowledge screen', () => {
    frame();
    expect(screen.getByRole('link', { name: 'Facts & sources' })).toHaveAttribute('href', '/app/knowledge');
  });

  it('marks where the owner is', () => {
    frame();
    expect(screen.getByRole('link', { name: 'My Curios' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /review/i })).not.toHaveAttribute('aria-current');
  });

  it('counts what is waiting beside Review, Questions and Leads', () => {
    frame({ badges: { review: 3, questions: 4, leads: 2, orders: 0 } });
    expect(screen.getByRole('link', { name: /review/i }).textContent).toBe('Review3');
    expect(screen.getByRole('link', { name: /questions/i }).textContent).toBe('Questions4');
    expect(screen.getByRole('link', { name: /leads/i }).textContent).toBe('Leads2');
  });

  it('shows no count when nothing is waiting', () => {
    frame({ badges: { review: 0, questions: 0, leads: 0, orders: 0 } });
    expect(screen.getByRole('link', { name: 'Review' }).textContent).toBe('Review');
    expect(screen.getByRole('link', { name: 'Questions' }).textContent).toBe('Questions');
  });

  it('renders the screen it wraps inside exactly one main landmark', () => {
    frame();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveTextContent('content');
  });

  // Both render straight from props, so swapping them would leave every test
  // above green.
  it("shows the owner's name, initials and plan", () => {
    frame();
    expect(screen.getByText('Iman Muqri')).toBeInTheDocument();
    expect(screen.getByText('IM')).toBeInTheDocument();
    expect(screen.getByText('Personal page')).toBeInTheDocument();
  });

  it("shows the owner's picture in place of initials when there is one", () => {
    const { container } = frame({ avatarUrl: 'https://cdn.example/a.webp' });
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example/a.webp');
    expect(screen.queryByText('IM')).toBeNull();
  });

  it('puts a dot on Billing when Billing needs the owner, and says so to a screen reader', () => {
    frame({ billingDot: true });
    expect(screen.getByRole('link', { name: /^Billing\s*, needs you$/ })).toBeInTheDocument();
  });

  it('puts no dot on Billing otherwise', () => {
    frame();
    expect(screen.queryByText(/needs you/)).toBeNull();
  });
});

describe('the theme switch', () => {
  const themed = (theme?: Theme) =>
    render(
      <AppFrame displayName="Iman Muqri" avatarUrl={null} planLabel="Personal page" badges={{ review: 0, questions: 0, leads: 0, orders: 0 }} mode="PERSONAL" {...(theme ? { theme } : {})}>
        <PageHead title="My Curios" />
      </AppFrame>,
    );
  const frameOf = (container: HTMLElement) => container.firstElementChild as HTMLElement;
  const option = (name: string) => within(screen.getByRole('group', { name: 'Theme' })).getByRole('button', { name });

  afterEach(() => {
    document.cookie = `${THEME_COOKIE}=; Path=/app; Max-Age=0`;
  });

  it('follows the device when nothing was chosen', () => {
    const { container } = themed();
    expect(frameOf(container)).toHaveAttribute('data-theme', 'system');
    expect(option('Match device')).toHaveAttribute('aria-pressed', 'true');
  });

  it('starts in the theme the layout read from the cookie', () => {
    const { container } = themed('dark');
    expect(frameOf(container)).toHaveAttribute('data-theme', 'dark');
    expect(option('Dark')).toHaveAttribute('aria-pressed', 'true');
    expect(option('Light')).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches the frame and remembers the choice in the cookie', () => {
    const cookie = vi.spyOn(document, 'cookie', 'set');
    const { container } = themed();
    fireEvent.click(option('Dark'));
    expect(frameOf(container)).toHaveAttribute('data-theme', 'dark');
    expect(cookie).toHaveBeenLastCalledWith(`${THEME_COOKIE}=dark; Path=/app; Max-Age=31536000; SameSite=Lax`);
    fireEvent.click(option('Match device'));
    expect(frameOf(container)).toHaveAttribute('data-theme', 'system');
    expect(cookie).toHaveBeenLastCalledWith(`${THEME_COOKIE}=; Path=/app; Max-Age=0; SameSite=Lax`);
    cookie.mockRestore();
  });

  it('is not drawn outside the frame', () => {
    render(<PageHead title="Alone" />);
    expect(screen.queryByRole('group', { name: 'Theme' })).toBeNull();
  });
});

describe('parseTheme', () => {
  it('keeps Light and Dark, and reads anything else as following the device', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme(undefined)).toBe('system');
    expect(parseTheme('blue')).toBe('system');
  });
});
