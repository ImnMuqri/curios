import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { NavBadges } from '@curios/db-read';
import type { Alert } from './alerts.js';
import { parseTheme, THEME_COOKIE, type Theme } from './theme.js';

const PLAN = { name: 'Business plan', note: '18 days left, until 14 Nov', fill: 0.6 };

const push = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => '/app/curios', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push }) }));
const { AppFrame } = await import('./app-frame.js');
const { PageHead } = await import('./_ui/page-head.js');

const frame = ({
  badges = { review: 3, questions: 0, leads: 0, orders: 0 },
  mode = 'PERSONAL',
  avatarUrl = null,
  billingDot = false,
  alerts = [],
}: { badges?: NavBadges; mode?: 'PERSONAL' | 'BUSINESS'; avatarUrl?: string | null; billingDot?: boolean; alerts?: Alert[] } = {}) =>
  render(
    <AppFrame displayName="Iman Muqri" avatarUrl={avatarUrl} plan={PLAN} badges={badges} mode={mode} billingDot={billingDot} alerts={alerts}>
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
  it("shows the owner's name and initials on the account button, and the page and screen in the breadcrumb", () => {
    const { container } = frame();
    expect(screen.getByRole('button', { name: 'Account' })).toHaveTextContent('IMIman Muqri');
    expect(container.querySelector('header p')).toHaveTextContent('Iman Muqri/My Curios');
  });

  it('shows the plan where the account block was, with its bar, and sends it to Billing', () => {
    const { container } = frame();
    const plan = screen.getByRole('link', { name: /Business plan/ });
    expect(plan).toHaveAttribute('href', '/app/billing');
    expect(plan).toHaveTextContent('18 days left, until 14 Nov');
    expect(container.querySelector('aside a[href="/app/billing"] i')).toHaveStyle({ width: '60%' });
  });

  it("puts the owner's own name on the account button when the account has one, the page's name in the breadcrumb", () => {
    const { container } = render(
      <AppFrame displayName="Kek Lina" ownerName="Lina binti Kamal" avatarUrl={null} plan={PLAN} badges={{ review: 0, questions: 0, leads: 0, orders: 0 }} mode="BUSINESS">
        <p>content</p>
      </AppFrame>,
    );
    expect(screen.getByRole('button', { name: 'Account' })).toHaveTextContent('LBLina binti Kamal');
    expect(container.querySelector('header p')).toHaveTextContent('Kek Lina/');
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
      <AppFrame displayName="Iman Muqri" avatarUrl={null} plan={PLAN} badges={{ review: 0, questions: 0, leads: 0, orders: 0 }} mode="PERSONAL" {...(theme ? { theme } : {})}>
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

  it('shows its three choices in the top bar, not behind a button or in the header', () => {
    const { container } = themed();
    expect(screen.queryByRole('button', { name: 'Theme' })).toBeNull();
    const group = screen.getByRole('group', { name: 'Theme' });
    expect(container.querySelector('header:not(main header)')).toContainElement(group);
    expect(within(group).getAllByRole('button')).toHaveLength(3);
  });

  it('is not drawn outside the frame', () => {
    render(<PageHead title="Alone" />);
    expect(screen.queryByRole('group', { name: 'Theme', hidden: true })).toBeNull();
  });
});

describe('search', () => {
  const box = () => screen.getByRole('searchbox', { name: 'Search the dashboard' });

  it('narrows the nav to the modules whose names match, and says so when none do', () => {
    frame({ mode: 'BUSINESS' });
    fireEvent.change(box(), { target: { value: 'or' } });
    expect(links().map((a) => a.textContent)).toEqual(['Store', 'Orders']);
    fireEvent.change(box(), { target: { value: 'zzz' } });
    expect(screen.getByText('Nothing called that')).toBeInTheDocument();
  });

  it('opens the first match on Enter, and Escape clears it', () => {
    push.mockClear();
    frame();
    fireEvent.change(box(), { target: { value: 'lead' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/app/leads');
    fireEvent.change(box(), { target: { value: 'set' } });
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(box()).toHaveValue('');
  });

  it('takes the cursor on "/", except while typing in a field', () => {
    frame();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(box()).toHaveFocus();
    box().blur();
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    fireEvent.keyDown(field, { key: '/' });
    expect(field).toHaveFocus();
    field.remove();
  });
});

describe('the top bar', () => {
  const bell = () => screen.getByRole('button', { name: /^Notifications/ });
  const alert: Alert = { id: 'trial', tone: 'stop', where: '/app/leads', icon: 'lead', title: 'Your free leads are used up', text: 'Upgrade to keep them coming.', action: { href: '/app/billing', label: 'Upgrade' } };

  it('lists what is waiting and the alerts under the bell, with the count in its name', () => {
    frame({ mode: 'BUSINESS', badges: { review: 1, questions: 0, leads: 2, orders: 3 }, alerts: [alert] });
    expect(bell()).toHaveAccessibleName('Notifications, 4 new');
    fireEvent.click(bell());
    expect(screen.getByRole('link', { name: '3 receipts to check' })).toHaveAttribute('href', '/app/orders');
    expect(screen.getByRole('link', { name: '2 new leads' })).toHaveAttribute('href', '/app/leads');
    expect(screen.getByRole('link', { name: '1 fact to review' })).toHaveAttribute('href', '/app/review');
    expect(screen.getByRole('link', { name: /Your free leads are used up/ })).toHaveAttribute('href', '/app/billing');
  });

  it('says nothing needs the owner when nothing does', () => {
    frame({ badges: { review: 0, questions: 0, leads: 0, orders: 0 } });
    expect(bell()).toHaveAccessibleName('Notifications');
    fireEvent.click(bell());
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument();
  });

  it('opens Settings, Billing and Sign out from the account button, and Escape closes it', () => {
    frame();
    const account = screen.getByRole('button', { name: 'Account' });
    fireEvent.click(account);
    expect(account).toHaveAttribute('aria-expanded', 'true');
    const menu = document.getElementById(account.getAttribute('aria-controls')!)!;
    expect(within(menu).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/app/settings');
    expect(within(menu).getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/app/billing');
    expect(within(menu).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(account).toHaveFocus();
  });

  it('puts the theme in the account menu a phone reaches from its row of icons', () => {
    frame();
    const account = screen.getByRole('button', { name: 'Account and theme' });
    fireEvent.click(account);
    const menu = document.getElementById(account.getAttribute('aria-controls')!)!;
    expect(within(menu).getByRole('group', { name: 'Theme' })).toBeInTheDocument();
  });
});

describe('PageHead', () => {
  it('puts one summary sentence under the title', () => {
    render(
      <PageHead
        title="Orders"
        summary={
          <>
            <b>2 receipts</b> to check.
          </>
        }
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    expect(screen.getByText('to check.', { exact: false })).toHaveTextContent('2 receipts to check.');
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
