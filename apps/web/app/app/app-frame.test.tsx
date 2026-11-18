import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { NavBadges } from '@curios/db-read';
import type { Alert } from './alerts.js';
import { parseTheme, THEME_COOKIE, type Theme } from './theme.js';
import type { BellSeen } from './bell-seen.js';

const PLAN = { name: 'Business plan', note: '18 days left, until 14 Nov', fill: 0.6, glance: 'Business · paid until 14 Nov' };

const push = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => '/app/curios', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push }) }));
// The Help panel reads its guide when it opens.
const apiFetch = vi.fn(async () => ({ sections: [], chat: true }));
vi.mock('../../lib/api.js', () => ({ apiFetch, ApiError: class extends Error {} }));
const { AppFrame } = await import('./app-frame.js');
const { PageHead } = await import('./_ui/page-head.js');
const { DarkModeRow, ThemeContext } = await import('./_ui/theme-switch.js');

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

const sideNav = () => within(screen.getByRole('navigation', { name: 'Dashboard' }));
const links = () => sideNav().getAllByRole('link');
/** The sidebar, and the account card at its top: the button that opens the account menu. */
const sideCol = () => within(screen.getByRole('complementary'));
const card = () => sideCol().getByRole('button', { name: /^Account, / });
/** The panel a popover button opens. */
const panelOf = (button: HTMLElement) => document.getElementById(button.getAttribute('aria-controls')!)!;

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
    expect(sideNav().getByRole('link', { name: 'Store' })).toHaveAttribute('href', '/app/store');
    expect(links().map((a) => a.textContent).slice(0, 2)).toEqual(['My Curios', 'Store']);
  });

  it('shows a personal page no Store link', () => {
    frame({ mode: 'PERSONAL' });
    expect(sideNav().queryByRole('link', { name: 'Store' })).toBeNull();
  });

  it('puts Orders first in the Inbox for a business page, counting the receipts to check', () => {
    frame({ mode: 'BUSINESS', badges: { review: 0, questions: 0, leads: 0, orders: 2 } });
    expect(sideNav().getByRole('link', { name: /^Orders/ })).toHaveAttribute('href', '/app/orders');
    expect(links().map((a) => a.textContent).slice(2, 5)).toEqual(['Orders2', 'Questions', 'Leads']);
  });

  it('shows a personal page no Orders link, whatever the count says', () => {
    frame({ mode: 'PERSONAL', badges: { review: 0, questions: 0, leads: 0, orders: 2 } });
    expect(sideNav().queryByRole('link', { name: /Orders/ })).toBeNull();
  });

  it('sends Facts & sources to the Knowledge screen', () => {
    frame();
    expect(sideNav().getByRole('link', { name: 'Facts & sources' })).toHaveAttribute('href', '/app/knowledge');
  });

  it('marks where the owner is', () => {
    frame();
    expect(sideNav().getByRole('link', { name: 'My Curios' })).toHaveAttribute('aria-current', 'page');
    expect(sideNav().getByRole('link', { name: /review/i })).not.toHaveAttribute('aria-current');
  });

  it('counts what is waiting beside Review, Questions and Leads', () => {
    frame({ badges: { review: 3, questions: 4, leads: 2, orders: 0 } });
    expect(sideNav().getByRole('link', { name: /review/i }).textContent).toBe('Review3');
    expect(sideNav().getByRole('link', { name: /questions/i }).textContent).toBe('Questions4');
    expect(sideNav().getByRole('link', { name: /leads/i }).textContent).toBe('Leads2');
  });

  it('shows no count when nothing is waiting', () => {
    frame({ badges: { review: 0, questions: 0, leads: 0, orders: 0 } });
    expect(sideNav().getByRole('link', { name: 'Review' }).textContent).toBe('Review');
    expect(sideNav().getByRole('link', { name: 'Questions' }).textContent).toBe('Questions');
  });

  it('renders the screen it wraps inside exactly one main landmark', () => {
    frame();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main')).toHaveTextContent('content');
  });

  // Both render straight from props, so swapping them would leave every test
  // above green.
  it('shows the page and the screen in the breadcrumb', () => {
    const { container } = frame();
    expect(container.querySelector('header p')).toHaveTextContent('Iman Muqri/My Curios');
  });

  it('marks the current page', () => {
    frame();
    expect(sideNav().getByRole('link', { name: 'My Curios' })).toHaveAttribute('aria-current', 'page');
    expect(sideNav().getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('shows 99+ for a count of 150', () => {
    frame({ badges: { review: 150, questions: 99, leads: 0, orders: 0 } });
    expect(sideNav().getByRole('link', { name: /review/i }).textContent).toBe('Review99+');
    expect(sideNav().getByRole('link', { name: /questions/i }).textContent).toBe('Questions99');
  });

  it('shows the plan at the foot of the sidebar, with its bar, and sends it to Billing', () => {
    const { container } = frame();
    const plan = sideCol().getByRole('link', { name: /18 days left/ });
    expect(plan).toHaveAttribute('href', '/app/billing');
    expect(plan).toHaveTextContent(/^Business18 days left, until 14 Nov$/);
    expect(container.querySelector('aside a[href="/app/billing"] i')).toHaveStyle({ width: '60%' });
  });

  it("puts the page's name on the sidebar card, with the owner's first name and the plan under it", () => {
    render(
      <AppFrame displayName="Kek Lina" ownerName="Lina binti Kamal" avatarUrl={null} plan={PLAN} badges={{ review: 0, questions: 0, leads: 0, orders: 0 }} mode="BUSINESS">
        <p>content</p>
      </AppFrame>,
    );
    expect(card()).toHaveTextContent(/^KKek LinaLina · Business$/);
    // Its name carries the page's name it shows (WCAG 2.5.3, label in name).
    expect(card()).toHaveAccessibleName('Account, Kek Lina');
  });

  it('shows the plan alone under the page name when the account has no name of its own', () => {
    frame();
    expect(card()).toHaveTextContent(/^IIman MuqriBusiness plan$/);
  });

  it('keeps the name and plan out of the top bar: the sidebar card carries them', () => {
    const { container } = frame();
    const top = container.querySelector('header:not(main header)')!;
    expect(top).not.toHaveTextContent('Business plan');
    expect(within(top as HTMLElement).queryByRole('group', { name: 'Theme' })).toBeNull();
  });

  it('truncates a long name in the card', () => {
    const css = readFileSync(path.resolve(__dirname, 'app-frame.module.css'), 'utf8');
    const ruleOf = (selector: string) => {
      const at = css.search(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s,{]`, 'm'));
      expect(at, selector).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf('}', at));
    };
    expect(ruleOf('.cardText')).toMatch(/min-width:\s*0/);
    const lines = ruleOf('.cardText b,');
    expect(lines).toMatch(/text-overflow:\s*ellipsis/);
    expect(lines).toMatch(/white-space:\s*nowrap/);
    expect(lines).toMatch(/overflow:\s*hidden/);
    expect(lines).toContain('.cardText small');
  });

  it("shows the page's picture in place of its initial when there is one", () => {
    frame({ avatarUrl: 'https://cdn.example/a.webp' });
    expect(card().querySelector('img')).toHaveAttribute('src', 'https://cdn.example/a.webp');
    expect(card()).toHaveTextContent(/^Iman Muqri/);
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

describe('dark mode', () => {
  const themed = (theme?: Theme) =>
    render(
      <AppFrame displayName="Iman Muqri" avatarUrl={null} plan={PLAN} badges={{ review: 0, questions: 0, leads: 0, orders: 0 }} mode="PERSONAL" {...(theme ? { theme } : {})}>
        <PageHead title="My Curios" />
      </AppFrame>,
    );
  const frameOf = (container: HTMLElement) => container.firstElementChild as HTMLElement;
  /** The Dark mode switch in the account menu, opened from the sidebar card. */
  const darkSwitch = () => {
    if (card().getAttribute('aria-expanded') !== 'true') fireEvent.click(card());
    return within(panelOf(card())).getByRole('switch', { name: 'Dark mode' });
  };
  const deviceIsDark = (dark: boolean) =>
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({ matches: dark && query === '(prefers-color-scheme: dark)', media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList,
    );

  afterEach(() => {
    document.cookie = `${THEME_COOKIE}=; Path=/app; Max-Age=0`;
    vi.restoreAllMocks();
  });

  it('follows the device when nothing was chosen', () => {
    const { container } = themed();
    expect(frameOf(container)).toHaveAttribute('data-theme', 'system');
    expect(darkSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('shows Dark mode on when nothing was chosen and the device is dark', () => {
    deviceIsDark(true);
    const { container } = themed();
    expect(frameOf(container)).toHaveAttribute('data-theme', 'system');
    expect(darkSwitch()).toHaveAttribute('aria-checked', 'true');
  });

  it('starts in the theme the layout read from the cookie', () => {
    deviceIsDark(true);
    const { container } = themed('light');
    expect(frameOf(container)).toHaveAttribute('data-theme', 'light');
    expect(darkSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('switches dark mode from the account menu', () => {
    const cookie = vi.spyOn(document, 'cookie', 'set');
    const { container } = themed();
    fireEvent.click(darkSwitch());
    // choose('dark'): the frame turns dark, the cookie remembers it, and the menu stays open.
    expect(frameOf(container)).toHaveAttribute('data-theme', 'dark');
    expect(cookie).toHaveBeenLastCalledWith(`${THEME_COOKIE}=dark; Path=/app; Max-Age=31536000; SameSite=Lax`);
    expect(card()).toHaveAttribute('aria-expanded', 'true');
    expect(darkSwitch()).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(darkSwitch());
    // choose('light'): an explicit choice, not back to following the device.
    expect(frameOf(container)).toHaveAttribute('data-theme', 'light');
    expect(cookie).toHaveBeenLastCalledWith(`${THEME_COOKIE}=light; Path=/app; Max-Age=31536000; SameSite=Lax`);
    expect(darkSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('turns a dark device light with one press', () => {
    deviceIsDark(true);
    const { container } = themed();
    fireEvent.click(darkSwitch());
    expect(frameOf(container)).toHaveAttribute('data-theme', 'light');
  });

  it('calls choose with dark, then light', () => {
    const choose = vi.fn();
    const { rerender } = render(
      <ThemeContext.Provider value={{ theme: 'system', choose }}>
        <DarkModeRow />
      </ThemeContext.Provider>,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Dark mode' }));
    expect(choose).toHaveBeenLastCalledWith('dark');
    rerender(
      <ThemeContext.Provider value={{ theme: 'dark', choose }}>
        <DarkModeRow />
      </ThemeContext.Provider>,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Dark mode' }));
    expect(choose).toHaveBeenLastCalledWith('light');
  });

  it('leaves the old three-way theme control out of the frame', () => {
    themed();
    expect(screen.queryByRole('group', { name: 'Theme', hidden: true })).toBeNull();
  });

  it('is not drawn outside the frame', () => {
    render(<DarkModeRow />);
    expect(screen.queryByRole('switch', { hidden: true })).toBeNull();
  });
});

describe('the top bar', () => {
  const bell = () => screen.getByRole('button', { name: /^Notifications/ });
  const alert: Alert = { id: 'trial', tone: 'stop', where: '/app/leads', icon: 'lead', title: 'Your free leads are used up', text: 'Upgrade to keep them coming.', action: { href: '/app/billing', label: 'Upgrade' } };

  it('opens notifications from the bell, in two sections, each row a link', () => {
    frame({ mode: 'BUSINESS', badges: { review: 1, questions: 0, leads: 2, orders: 3 }, alerts: [alert] });
    // The badge counts what is new: 3 receipts, 2 leads, 1 fact and the alert.
    expect(bell()).toHaveAccessibleName('Notifications, 7 new');
    expect(bell()).toHaveTextContent('7');
    expect(panelOf(bell())).not.toBeVisible();
    fireEvent.click(bell());
    expect(bell()).toHaveAttribute('aria-expanded', 'true');
    const panel = panelOf(bell());
    expect(panel).toBeVisible();
    expect(within(panel).getByText('Notifications')).toBeInTheDocument();
    const waiting = within(within(panel).getByRole('group', { name: 'Waiting on you' }));
    const heads = within(within(panel).getByRole('group', { name: 'Heads up' }));
    expect(waiting.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/app/orders', '/app/leads', '/app/review']);
    expect(waiting.getByRole('link', { name: /^3 receipts to check/ })).toHaveTextContent('Check each one and mark it paid.');
    expect(waiting.getByRole('link', { name: /^2 new leads/ })).toHaveTextContent('Reply within the day, leads go cold.');
    expect(waiting.getByRole('link', { name: /^1 fact to review/ })).toHaveAttribute('href', '/app/review');
    // The "!" in its icon is decoration: the row's name starts with the alert's title.
    expect(heads.getByRole('link', { name: /^Your free leads are used up/ })).toHaveAttribute('href', '/app/billing');
    expect(heads.getByRole('link', { name: /Your free leads are used up/ })).toHaveTextContent('Upgrade to keep them coming.');
    expect(panel).toHaveTextContent('Things stay here until they’re done. Mark all as read only clears the badge.');
  });

  it('lists new questions under Waiting on you, and leaves out a section with nothing in it', () => {
    frame({ badges: { review: 0, questions: 2, leads: 0, orders: 0 } });
    fireEvent.click(bell());
    const panel = panelOf(bell());
    expect(within(panel).getByRole('link', { name: /^2 new questions/ })).toHaveAttribute('href', '/app/questions');
    expect(within(panel).queryByRole('group', { name: 'Heads up' })).toBeNull();
  });

  it('says Nothing needs you right now when empty', () => {
    frame({ badges: { review: 0, questions: 0, leads: 0, orders: 0 } });
    expect(bell()).toHaveAccessibleName('Notifications');
    expect(bell()).toHaveTextContent('');
    fireEvent.click(bell());
    const panel = within(panelOf(bell()));
    expect(panel.getByText('Nothing needs you right now.')).toBeInTheDocument();
    expect(panel.queryByRole('group')).toBeNull();
    expect(panel.queryByRole('link')).toBeNull();
    expect(panel.queryByRole('button', { name: 'Mark all as read' })).toBeNull();
  });

  it('closes notifications on Escape and returns focus to the bell', () => {
    frame({ badges: { review: 2, questions: 0, leads: 0, orders: 0 } });
    fireEvent.click(bell());
    within(panelOf(bell())).getByRole('link', { name: /^2 facts to review/ }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(bell()).toHaveAttribute('aria-expanded', 'false');
    expect(panelOf(bell())).not.toBeVisible();
    expect(bell()).toHaveFocus();
  });

  it('shows 99+ on the bell for 150 new things', () => {
    frame({ mode: 'BUSINESS', badges: { review: 0, questions: 0, leads: 0, orders: 150 } });
    expect(bell()).toHaveTextContent('99+');
    expect(bell()).toHaveAccessibleName('Notifications, 99+ new');
  });

  it("names the phone's account button after the page, as the sidebar card is named", () => {
    frame();
    const accounts = screen.getAllByRole('button', { name: 'Account, Iman Muqri' });
    // The sidebar's card and the phone top bar's avatar.
    expect(accounts).toHaveLength(2);
  });

  it('draws the top bar in ink: an ink focus ring, and the bell as a sheet on a phone', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'app-frame.module.css'), 'utf8');
    const focus = css.match(/\.account:focus-visible[^{]*\{([^}]*)\}/)?.[1] ?? '';
    expect(focus).toContain('var(--ink)');
    expect(focus).not.toContain('biru');
    const phone = css.slice(css.indexOf('/* ---- Notifications on a phone'));
    expect(phone).toMatch(/@media \(max-width: 760px\)\s*\{\s*\.top \.notifications\s*\{[^}]*position: fixed;[^}]*bottom: /);
    // The rows' stagger and the badge's pop are motion: off under reduced motion.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.nfRow[^{]*\{\s*animation: none;/);
  });

  const business = (badges: NavBadges, bellSeen?: BellSeen, alerts: Alert[] = [alert]) =>
    render(
      <AppFrame displayName="Kek Lina" avatarUrl={null} plan={PLAN} badges={badges} mode="BUSINESS" alerts={alerts} bellSeen={bellSeen}>
        <p>content</p>
      </AppFrame>,
    );

  it('marks all as read without removing the rows', () => {
    const cookie = vi.spyOn(document, 'cookie', 'set');
    business({ review: 1, questions: 0, leads: 2, orders: 0 });
    fireEvent.click(bell());
    expect(screen.getByRole('link', { name: /^2 new leads/ })).toHaveAttribute('data-new');
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    expect(bell()).toHaveAccessibleName('Notifications');
    expect(bell()).toHaveTextContent('');
    // Read clears only the badge: the panel stays open and every row is still there, without its dot.
    expect(bell()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: /^2 new leads/ })).not.toHaveAttribute('data-new');
    expect(screen.getByRole('link', { name: /^1 fact to review/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Your free leads are used up/ })).not.toHaveAttribute('data-new');
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).not.toBeInTheDocument();
    expect(cookie).toHaveBeenLastCalledWith('curios_bell=leads:2.review:1|trial; Path=/app; Max-Age=31536000; SameSite=Lax');
    cookie.mockRestore();
  });

  it('counts as new only what came after the read: a higher count, an alert not read', () => {
    const fresh: Alert = { ...alert, id: 'paused', title: 'Orders are paused', action: undefined };
    business({ review: 1, questions: 0, leads: 3, orders: 0 }, { counts: { leads: 2, review: 1 }, alerts: ['trial'] }, [alert, fresh]);
    expect(bell()).toHaveAccessibleName('Notifications, 2 new');
    fireEvent.click(bell());
    expect(screen.getByRole('link', { name: /^3 new leads/ })).toHaveAttribute('data-new');
    expect(screen.getByRole('link', { name: /^1 fact to review/ })).not.toHaveAttribute('data-new');
    expect(screen.getByText('Orders are paused').closest('[data-new]')).not.toBeNull();
  });

  it('forgets a read count that went down, so the next one up is news', () => {
    const cookie = vi.spyOn(document, 'cookie', 'set');
    business({ review: 0, questions: 0, leads: 1, orders: 0 }, { counts: { leads: 2 }, alerts: [] }, []);
    expect(bell()).toHaveAccessibleName('Notifications');
    expect(cookie).toHaveBeenLastCalledWith('curios_bell=leads:1|; Path=/app; Max-Age=31536000; SameSite=Lax');
    cookie.mockRestore();
  });

  it('opens and closes the Help panel from the top bar, showing Help as pressed while it is open', () => {
    frame();
    const help = screen.getByRole('button', { name: 'Help' });
    expect(help).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(help);
    expect(help).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/help/guide');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
    expect(help).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('the account menu', () => {
  const openAccount = () => {
    render(
      <AppFrame
        displayName="Kek Lina"
        ownerName="Lina binti Kamal"
        ownerEmail="lina@keklina.example"
        usage={{ used: 41, cap: 200 }}
        avatarUrl={null}
        plan={PLAN}
        badges={{ review: 0, questions: 0, leads: 0, orders: 0 }}
        mode="BUSINESS"
      >
        <p>content</p>
      </AppFrame>,
    );
    const account = card();
    expect(account).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(account);
    return { account, menu: within(panelOf(account)), panel: panelOf(account) };
  };

  it('opens the account menu from the sidebar card, with usage, plan, and the four items', () => {
    const { account, menu, panel } = openAccount();
    expect(account).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toBeVisible();
    expect(panel).toHaveTextContent('Lina binti Kamallina@keklina.example');
    expect(panel).toHaveTextContent('Conversations this month41 / 200');
    expect(panel.querySelector('i[style]')).toHaveStyle({ width: '20.5%' });
    expect(panel).toHaveTextContent('Business · paid until 14 Nov');
    expect(menu.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/app/billing');
    expect(menu.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/app/settings');
    expect(menu.getByRole('button', { name: 'Help & support' })).toBeInTheDocument();
    expect(menu.getByRole('switch', { name: 'Dark mode' })).toBeInTheDocument();
    expect(menu.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    // The four, in the board's order, and no Billing row (Manage goes there).
    const rows = [...panel.querySelectorAll('a, button')].map((el) => el.textContent?.trim()).filter((text) => text !== 'Manage');
    expect(rows).toEqual(['Settings', 'Help & support', 'Dark mode', 'Sign out']);
  });

  it('closes the account menu on Escape and gives focus back to the card', () => {
    const { account, menu } = openAccount();
    menu.getByRole('link', { name: 'Settings' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(account).toHaveFocus();
  });

  it('opens Help from Help & support, closing the menu', () => {
    const { account, menu } = openAccount();
    fireEvent.click(menu.getByRole('button', { name: 'Help & support' }));
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeInTheDocument();
  });

  it('closes when the owner clicks outside it', () => {
    const { account } = openAccount();
    fireEvent.pointerDown(document.body);
    expect(account).toHaveAttribute('aria-expanded', 'false');
  });
});

describe("a phone's bottom menu", () => {
  const dock = () => within(screen.getByRole('navigation', { name: 'Main navigation' }));

  it('has Page, Store, Inbox, Review and More for a business page, and no Store for a personal one', () => {
    frame({ mode: 'BUSINESS' });
    expect(dock().getAllByRole('link').map((a) => a.textContent)).toEqual(['Page', 'Store', 'Inbox', 'Review3']);
    expect(dock().getByRole('button', { name: 'More' })).toBeInTheDocument();
    cleanup();
    frame({ mode: 'PERSONAL' });
    expect(dock().getAllByRole('link').map((a) => a.textContent)).toEqual(['Page', 'Inbox', 'Review3']);
  });

  it('counts the three inboxes together on Inbox, and the facts to check on Review', () => {
    frame({ mode: 'BUSINESS', badges: { review: 3, questions: 1, leads: 4, orders: 2 } });
    expect(dock().getByRole('link', { name: /^Inbox/ })).toHaveTextContent('Inbox7');
    expect(dock().getByRole('link', { name: /^Review/ })).toHaveTextContent('Review3');
  });

  it('sends Inbox to Orders on a business page, and to Questions on a personal one', () => {
    frame({ mode: 'BUSINESS' });
    expect(dock().getByRole('link', { name: /^Inbox/ })).toHaveAttribute('href', '/app/orders');
    cleanup();
    frame({ mode: 'PERSONAL' });
    expect(dock().getByRole('link', { name: /^Inbox/ })).toHaveAttribute('href', '/app/questions');
  });

  it('marks the tab you are on', () => {
    frame();
    expect(dock().getByRole('link', { name: 'Page' })).toHaveAttribute('aria-current', 'page');
    expect(dock().getByRole('link', { name: /^Review/ })).not.toHaveAttribute('aria-current');
  });

  it('opens More as a sheet of Facts & sources, Billing and Settings, and Escape closes it', () => {
    frame({ billingDot: true });
    const more = dock().getByRole('button', { name: 'More' });
    const sheet = document.getElementById(more.getAttribute('aria-controls')!)!;
    expect(sheet).not.toBeVisible();
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(within(sheet).getAllByRole('link').map((a) => a.textContent)).toEqual(['Facts & sources', 'Billing, needs you', 'Settings']);
    expect(within(sheet).getByText('Knowledge')).toBeInTheDocument();
    expect(within(sheet).getByText('Account')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the sheet when the page behind it is tapped', () => {
    frame();
    fireEvent.click(dock().getByRole('button', { name: 'More' }));
    fireEvent.click(dock().getByRole('button', { name: 'Close' }));
    expect(dock().getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe("the document behind the frame", () => {
  it("takes the frame's ground, for the browser's bars as well, and gives both back when the frame goes", () => {
    const { unmount } = frame();
    const meta = document.querySelector('meta[name="theme-color"]');
    expect(meta).not.toBeNull();
    const ground = getComputedStyle(document.querySelector('[data-theme]')!).backgroundColor;
    expect(meta!.getAttribute('content')).toBe(ground);
    // iOS 26 Safari colours the status bar's strip from the body.
    expect(document.body.style.backgroundColor).toBe(document.documentElement.style.backgroundColor);
    unmount();
    expect(document.querySelector('meta[name="theme-color"]')).toBeNull();
    expect(document.documentElement.style.backgroundColor).toBe('');
    expect(document.body.style.backgroundColor).toBe('');
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
