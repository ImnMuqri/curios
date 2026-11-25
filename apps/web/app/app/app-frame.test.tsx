import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { NavBadges } from '@curios/db-read';
import type { Alert } from './alerts.js';
import { parseTheme, THEME_COOKIE, type Theme } from './theme.js';
import type { BellSeen } from './bell-seen.js';

const PLAN = { name: 'Business plan', note: '18 days left, until 14 Nov', fill: 0.6, glance: 'Business · paid until 14 Nov' };

const push = vi.fn();
/** The page the frame is on; a test may move it, and it goes back to My Curios after each. */
const at = vi.hoisted(() => ({ pathname: '/app/curios' }));
vi.mock('next/navigation', () => ({ usePathname: () => at.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push }) }));
afterEach(() => {
  at.pathname = '/app/curios';
});
// The Help panel reads its guide when it opens.
const apiFetch = vi.fn(async () => ({ sections: [], chat: true }));
vi.mock('../../lib/api.js', () => ({ apiFetch, ApiError: class extends Error {} }));
const { AppFrame } = await import('./app-frame.js');
const { PageHead } = await import('./_ui/page-head.js');
const { usePublishSaveStatus } = await import('./_ui/save-status.js');
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

  it('draws no breadcrumb: the top bar has only Help and the bell (and the phone avatar)', () => {
    const { container } = frame();
    const top = container.querySelector('header:not(main header)') as HTMLElement;
    expect(top.querySelector(':scope > p')).toBeNull();
    expect(top).not.toHaveTextContent('My Curios');
    expect(within(top).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Help', 'Notifications, 3 new', 'Account, Iman Muqri']);
  });

  it('runs the same hooks with and without the frame, so a page arriving does not break it', () => {
    const props = { displayName: 'Iman Muqri', avatarUrl: null, plan: PLAN, badges: { review: 1, questions: 0, leads: 0, orders: 0 }, mode: 'PERSONAL' as const };
    const { rerender } = render(
      <AppFrame {...props} bare>
        <p>content</p>
      </AppFrame>,
    );
    expect(() =>
      rerender(
        <AppFrame {...props}>
          <p>content</p>
        </AppFrame>,
      ),
    ).not.toThrow();
    expect(screen.getByRole('navigation', { name: 'Dashboard' })).toBeInTheDocument();
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
    // Its name carries all the text it shows, the line under the name too (WCAG 2.5.3, label in name).
    expect(card()).toHaveAccessibleName('Account, Kek Lina, Lina · Business');
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
    expect(within(panel).getByRole('link', { name: /^2 questions need your answer/ })).toHaveAttribute('href', '/app/questions');
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
    // The sidebar's card says what it shows (the plan under the name); the phone top bar's avatar shows no text.
    expect(screen.getAllByRole('button', { name: /^Account, / }).map((b) => b.getAttribute('aria-label'))).toEqual(['Account, Iman Muqri, Business plan', 'Account, Iman Muqri']);
  });

  it('draws the top bar in ink: an ink focus ring, and the bell as a sheet on a phone', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'app-frame.module.css'), 'utf8');
    const focus = css.match(/\.account:focus-visible[^{]*\{([^}]*)\}/)?.[1] ?? '';
    expect(focus).toContain('var(--ink)');
    expect(focus).not.toContain('biru');
    const phone = css.slice(css.indexOf('/* ---- Notifications on a phone'));
    expect(phone).toMatch(/@media \(max-width: 1100px\)\s*\{\s*\.top \.notifications\s*\{[^}]*position: fixed;[^}]*bottom: /);
    // The scrim is a real element that takes the tap on a phone, and is not drawn on a desktop.
    expect(css).toMatch(/\.top \.notifyScrim\s*\{[^}]*display: none;/);
    expect(phone).toMatch(/\.top \.notifyScrim:not\(\[hidden\]\)\s*\{[^}]*display: block;[^}]*position: fixed;[^}]*inset: 0;/);
    expect(phone).not.toContain('100vmax');
    // The badge does not pop in on load: the board animates only its leaving.
    const unread = css.match(/\n\.unread\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(unread).not.toContain('animation');
    // The rows' stagger is motion: off under reduced motion.
    const rows = readFileSync(path.join(import.meta.dirname, '_ui/notifications.module.css'), 'utf8');
    expect(rows).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.row[^{]*\{\s*animation: none;/);
  });

  it('takes a tap outside the open sheet itself, so it never reaches what is under it', () => {
    const markPaid = vi.fn();
    render(
      <AppFrame displayName="Kek Lina" avatarUrl={null} plan={PLAN} badges={{ review: 0, questions: 0, leads: 0, orders: 2 }} mode="BUSINESS">
        <button type="button" onClick={markPaid}>
          Mark paid
        </button>
      </AppFrame>,
    );
    expect(document.querySelector('[data-scrim]')).toBeNull();
    fireEvent.click(bell());
    const scrim = document.querySelector('[data-scrim]') as HTMLElement;
    expect(scrim).not.toBeNull();
    expect(scrim).toHaveAttribute('aria-hidden', 'true');
    // A tap on the page behind lands on the scrim: pointerdown and click both hit it, not Mark paid.
    fireEvent.pointerDown(scrim);
    fireEvent.click(scrim);
    expect(markPaid).not.toHaveBeenCalled();
    expect(bell()).toHaveAttribute('aria-expanded', 'false');
    expect(bell()).toHaveFocus();
    expect(document.querySelector('[data-scrim]')).toBeNull();
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
    // Focus stays in the panel: it moves to the first row as the button goes.
    expect(screen.getByRole('link', { name: /^2 new leads/ })).toHaveFocus();
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
    const help = within(screen.getByRole('banner')).getByRole('button', { name: 'Help' });
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

describe("a phone's menu", () => {
  const dock = () => within(screen.getByRole('navigation', { name: 'Menu' }));
  const more = () => dock().getByRole('button', { name: /^More/ });
  const scrollTo = (y: number) => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
  };
  afterEach(() => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  it('has Page, Store, Orders, Questions and More for a business page, and no Store or Orders for a personal one', () => {
    frame({ mode: 'BUSINESS' });
    expect(dock().getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/app/curios', '/app/store', '/app/orders', '/app/questions']);
    expect(dock().getAllByRole('link').map((a) => a.textContent)).toEqual(['Page', 'Store', 'Orders', 'Questions']);
    expect(more()).toBeInTheDocument();
    cleanup();
    frame({ mode: 'PERSONAL' });
    expect(dock().getAllByRole('link').map((a) => a.textContent)).toEqual(['Page', 'Questions']);
  });

  it('shows only the active tab label in the phone menu', () => {
    at.pathname = '/app/orders/abc';
    frame({ mode: 'BUSINESS' });
    const tabs = dock().getAllByRole('link');
    // Every tab keeps its name for a screen reader; only the one you are on is current and shows its label.
    expect(tabs.map((a) => a.getAttribute('aria-current'))).toEqual([null, null, 'page', null]);
    expect(tabs.map((a) => a.hasAttribute('data-on'))).toEqual([false, false, true, false]);
    expect(dock().getByRole('link', { name: 'Page' })).toBeInTheDocument();
    expect(more()).not.toHaveAttribute('data-on');
    // The label is clipped to nothing and faded on every other tab, and opens on the one you are on.
    const css = readFileSync(path.join(import.meta.dirname, '_ui/phone-menu.module.css'), 'utf8');
    expect(css).toMatch(/\n\.clip\s*\{[^}]*grid-template-columns: 0fr;[^}]*overflow: hidden;/);
    expect(css).toMatch(/\.tab\[data-on\] \.clip\s*\{[^}]*grid-template-columns: 1fr;/);
    expect(css).toMatch(/\n\.label\s*\{[^}]*opacity: 0;/);
    expect(css).toMatch(/\.tab\[data-on\] \.label\s*\{[^}]*opacity: 1;/);
  });

  it('puts the pill on More on a page the menu has no tab for', () => {
    at.pathname = '/app/leads';
    frame({ mode: 'BUSINESS' });
    expect(dock().getAllByRole('link').every((a) => !a.hasAttribute('aria-current'))).toBe(true);
    expect(more()).toHaveAttribute('data-on');
  });

  it('springs the pill and the tabs, the leading edge first, and stills it all under reduced motion', () => {
    const css = readFileSync(path.join(import.meta.dirname, '_ui/phone-menu.module.css'), 'utf8');
    // The pill and the labels take the board's gentle 1.3 spring; the sharper 1.7 is only the icon's press (ruling R13).
    expect(css).toMatch(/--menu-spring: cubic-bezier\(0\.3, 1\.3, 0\.5, 1\);/);
    expect(css).toMatch(/\n\.icon\s*\{[^}]*transition: transform 0\.35s cubic-bezier\(0\.3, 1\.7, 0\.5, 1\);/);
    // Moving right the right edge leads, moving left the left edge does.
    const right = css.match(/\.dock\[data-dir='right'\] \.pill\s*\{([^}]*)\}/)?.[1] ?? '';
    const left = css.match(/\.dock\[data-dir='left'\] \.pill\s*\{([^}]*)\}/)?.[1] ?? '';
    const secs = (rule: string, prop: string) => Number(rule.match(new RegExp(`${prop} ([0-9.]+)s`))?.[1]);
    expect(secs(right, '--pill-r')).toBeLessThan(secs(right, '--pill-l'));
    expect(secs(left, '--pill-l')).toBeLessThan(secs(left, '--pill-r'));
    // The icon gives under a press.
    expect(css).toMatch(/\.tab:active \.icon\s*\{[^}]*scale\(0\.84\)/);
    const still = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(still).toMatch(/transition: none/);
    expect(still).toMatch(/animation: none/);
    // Shown only under 1100px, where the sidebar goes.
    expect(css).toMatch(/\n\.dock\s*\{[^}]*display: none;/);
    expect(css).toMatch(/@media \(max-width: 1100px\)\s*\{\s*\.dock\s*\{[^}]*display: flex;/);
  });

  it('reads 99+ on a tab past 99', () => {
    frame({ mode: 'BUSINESS', badges: { review: 0, questions: 4, leads: 0, orders: 150 } });
    expect(dock().getByRole('link', { name: 'Orders, 99+' })).toHaveTextContent('99+');
    expect(dock().getByRole('link', { name: 'Questions, 4' })).toBeInTheDocument();
  });

  it('opens More as a sheet of Leads, Review, Facts & sources, Billing and Settings, and Escape closes it', () => {
    frame({ mode: 'BUSINESS', billingDot: true, badges: { review: 3, questions: 0, leads: 2, orders: 0 } });
    const sheet = document.getElementById(more().getAttribute('aria-controls')!)!;
    expect(more()).toHaveAttribute('aria-expanded', 'false');
    expect(sheet).not.toBeVisible();
    fireEvent.click(more());
    expect(more()).toHaveAttribute('aria-expanded', 'true');
    expect(sheet).toBeVisible();
    expect(within(sheet).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/app/leads', '/app/review', '/app/knowledge', '/app/billing', '/app/settings']);
    expect(within(sheet).getByRole('link', { name: 'Leads, 2' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Review, 3' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Billing, needs you' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(more()).toHaveAttribute('aria-expanded', 'false');
    expect(more()).toHaveFocus();
  });

  it('marks the page you are on in the More sheet', () => {
    at.pathname = '/app/settings';
    frame();
    fireEvent.click(more());
    const sheet = document.getElementById(more().getAttribute('aria-controls')!)!;
    expect(within(sheet).getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(within(sheet).getByRole('link', { name: 'Billing' })).not.toHaveAttribute('aria-current');
  });

  it('closes the sheet when the page behind it is tapped, and the tap goes no further', () => {
    const markPaid = vi.fn();
    render(
      <AppFrame displayName="Kek Lina" avatarUrl={null} plan={PLAN} badges={{ review: 0, questions: 0, leads: 0, orders: 0 }} mode="BUSINESS">
        <button type="button" onClick={markPaid}>
          Mark paid
        </button>
      </AppFrame>,
    );
    fireEvent.click(more());
    const scrim = screen.getByRole('navigation', { name: 'Menu' }).querySelector('[data-scrim]') as HTMLElement;
    expect(scrim).not.toBeNull();
    fireEvent.pointerDown(scrim);
    fireEvent.click(scrim);
    expect(markPaid).not.toHaveBeenCalled();
    expect(more()).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides the phone menu on scroll down and shows it on scroll up', () => {
    frame();
    const nav = screen.getByRole('navigation', { name: 'Menu' });
    expect(nav).not.toHaveAttribute('data-away');
    scrollTo(200);
    scrollTo(400);
    expect(nav).toHaveAttribute('data-away');
    // A jitter of a few pixels back up does not bring it back.
    scrollTo(397);
    expect(nav).toHaveAttribute('data-away');
    scrollTo(300);
    expect(nav).not.toHaveAttribute('data-away');
  });

  it('comes back when the keyboard reaches a hidden menu', () => {
    frame();
    const nav = screen.getByRole('navigation', { name: 'Menu' });
    scrollTo(200);
    scrollTo(400);
    expect(nav).toHaveAttribute('data-away');
    act(() => {
      dock().getByRole('link', { name: 'Page' }).focus();
    });
    expect(nav).not.toHaveAttribute('data-away');
  });

  it('places the pill again when the tabs change without a navigation', () => {
    at.pathname = '/app/questions';
    const props = { displayName: 'Kek Lina', avatarUrl: null, plan: PLAN, badges: { review: 0, questions: 0, leads: 0, orders: 0 } };
    const { rerender } = render(
      <AppFrame {...props} mode="PERSONAL">
        <p>content</p>
      </AppFrame>,
    );
    const pill = () => (screen.getByRole('navigation', { name: 'Menu' }).children[1] as HTMLElement).style.getPropertyValue('--pill-l');
    // Page, Questions: the pill starts past one circle.
    expect(pill()).toBe('56px');
    rerender(
      <AppFrame {...props} mode="BUSINESS">
        <p>content</p>
      </AppFrame>,
    );
    // Page, Store, Orders, Questions: past three.
    expect(pill()).toBe('156px');
  });

  it('puts a dot on More when Leads, inside it, has a count, and says so in its name', () => {
    frame({ badges: { review: 0, questions: 0, leads: 2, orders: 0 } });
    expect(more()).toHaveAccessibleName('More, new items');
    expect(more().querySelector('[data-more-dot]')).not.toBeNull();
    // A dot, not a summed count.
    expect(more().querySelector('[data-more-dot]')).toHaveTextContent('');
  });

  it('puts a dot on More when Billing has an alert', () => {
    frame({ billingDot: true, badges: { review: 0, questions: 0, leads: 0, orders: 0 } });
    expect(more()).toHaveAccessibleName('More, new items');
    expect(more().querySelector('[data-more-dot]')).not.toBeNull();
  });

  it('puts no dot on More when nothing inside it needs the owner (a count on a tab of its own is no reason)', () => {
    frame({ mode: 'BUSINESS', badges: { review: 0, questions: 4, leads: 0, orders: 2 } });
    expect(more()).toHaveAccessibleName('More');
    expect(more().querySelector('[data-more-dot]')).toBeNull();
  });

  it("draws More's dot as the dock's badge dot: the badge red, ringed like the tabs' counts", () => {
    const css = readFileSync(path.join(import.meta.dirname, '_ui/phone-menu.module.css'), 'utf8');
    const dot = css.match(/\n\.moreDot\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(dot).toMatch(/background:\s*var\(--badge\);/);
    expect(dot).toMatch(/box-shadow:\s*0 0 0 2px var\(--card\);/);
    expect(dot).toMatch(/border-radius:\s*50%;/);
    expect(css).toMatch(/\.tab\[data-on\] \.moreDot\s*\{[^}]*box-shadow:\s*0 0 0 2px var\(--select\);/);
  });

  it('stays while More is open, and near the top of the page', () => {
    frame();
    const nav = screen.getByRole('navigation', { name: 'Menu' });
    scrollTo(40);
    expect(nav).not.toHaveAttribute('data-away');
    fireEvent.click(more());
    scrollTo(400);
    expect(nav).not.toHaveAttribute('data-away');
  });
});

describe('two overlays', () => {
  const top = () => within(document.querySelector('header:not(main header)') as HTMLElement);
  const bell = () => screen.getByRole('button', { name: /^Notifications/ });
  const more = () => within(screen.getByRole('navigation', { name: 'Menu' })).getByRole('button', { name: /^More/ });
  const help = () => top().getByRole('button', { name: 'Help' });
  const css = (file: string) => readFileSync(path.join(import.meta.dirname, file), 'utf8');

  it("gives focus back to the phone's avatar after Help & support from its account menu", () => {
    frame();
    const avatar = top().getByRole('button', { name: /^Account, / });
    fireEvent.click(avatar);
    const row = within(panelOf(avatar)).getByRole('button', { name: 'Help & support' });
    act(() => row.focus());
    fireEvent.click(row);
    expect(avatar).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
    // The row sits in a closed (hidden) panel by now: the avatar that opened that panel takes focus.
    expect(avatar).toHaveFocus();
  });

  it('closes an open popover when Help opens, so one Escape closes Help alone', () => {
    frame({ badges: { review: 2, questions: 0, leads: 0, orders: 0 } });
    fireEvent.click(bell());
    expect(bell()).toHaveAttribute('aria-expanded', 'true');
    // Shift+Tab out of the sheet to Help, and Enter.
    act(() => help().focus());
    fireEvent.click(help());
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeInTheDocument();
    expect(bell()).toHaveAttribute('aria-expanded', 'false');
    expect(panelOf(bell())).not.toBeVisible();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
    expect(help()).toHaveFocus();
  });

  it('opens the bell over More by closing More, and Escape then closes only the bell', () => {
    frame({ badges: { review: 2, questions: 0, leads: 1, orders: 0 } });
    fireEvent.click(more());
    expect(more()).toHaveAttribute('aria-expanded', 'true');
    // By keyboard: no tap outside to close More on the way.
    act(() => bell().focus());
    fireEvent.click(bell());
    expect(bell()).toHaveAttribute('aria-expanded', 'true');
    expect(more()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(bell()).toHaveAttribute('aria-expanded', 'false');
    expect(bell()).toHaveFocus();
    expect(more()).toHaveAttribute('aria-expanded', 'false');
  });

  it("lifts the top bar over the dock while any of its panels is open on a phone, the account panel too", () => {
    const frameCss = css('app-frame.module.css');
    const phone = frameCss.slice(frameCss.indexOf('/* ---- Notifications on a phone'));
    const lift = phone.match(/\.top:has\(([^{]*)\)\s*\{\s*z-index:\s*(\d+);/);
    expect(lift).not.toBeNull();
    expect(lift![1]).toContain('.notifications:not([hidden])');
    expect(lift![1]).toContain('.phonePanel:not([hidden])');
    const dock = Number(css('_ui/phone-menu.module.css').match(/@media \(max-width: 1100px\)\s*\{\s*\.dock\s*\{[^}]*z-index:\s*(\d+);/)?.[1]);
    expect(Number(lift![2])).toBeGreaterThan(dock);
  });

  it('dims the page behind More, the bell and Help with one scrim', () => {
    expect(css('_ui/phone-menu.module.css')).toMatch(/\n\.scrim\s*\{[^}]*background:\s*var\(--calm-scrim\);/);
    expect(css('app-frame.module.css')).toMatch(/\.top \.notifyScrim:not\(\[hidden\]\)\s*\{[^}]*background:\s*var\(--calm-scrim\);/);
    expect(css('help/help.module.css')).toMatch(/\n\.scrim\s*\{[^}]*background:\s*var\(--calm-scrim\);/);
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

/** A screen that saves as its owner types: it publishes its status to the frame's top bar, as My Curios does. */
function Saves({ state }: { state: 'saving' | 'failed' | 'saved' }) {
  usePublishSaveStatus(state);
  return <p>a saving screen</p>;
}

describe('the sidebar, on white (24 Nov)', () => {
  const sideCss = () => readFileSync(path.join(import.meta.dirname, 'app-frame.module.css'), 'utf8');
  /** The declarations of one top-level rule of the frame's stylesheet. */
  const ruleOf = (selector: string) => {
    const css = sideCss();
    const start = css.indexOf(`\n${selector} {`);
    expect(start, selector).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  };

  it('is one white surface: the ground, the card and the paper are all the calm surface, with the frame\'s own soft fill and line', () => {
    const root = ruleOf('.frame');
    expect(root).toMatch(/--ground:\s*var\(--calm-surface\)/);
    expect(root).toMatch(/--card:\s*var\(--calm-surface\)/);
    expect(root).toMatch(/--surface:\s*var\(--frame-soft\)/);
    expect(root).toMatch(/--line:\s*var\(--frame-line\)/);
    // No separate sheet on a different ground, and no hairline drawn round it.
    expect(sideCss()).not.toContain('.sheet::before');
    expect(ruleOf('.sheet')).not.toContain('box-shadow');
    // The page is painted with the ground, so in dark it isn't a lighter card under a darker top bar.
    expect(ruleOf('.sheet')).toMatch(/background:\s*var\(--ground\)/);
  });

  it('draws the nav items 40px tall with 12px gaps, 14.5px text and 19px icons, 2px apart', () => {
    const item = ruleOf('.item');
    expect(item).toMatch(/height:\s*40px/);
    expect(item).toMatch(/gap:\s*12px/);
    expect(item).toMatch(/padding:\s*0 14px/);
    expect(item).toMatch(/font-size:\s*14\.5px/);
    expect(ruleOf('.item + .item')).toMatch(/margin-top:\s*2px/);
    expect(ruleOf('.item .icon')).toMatch(/width:\s*19px/);
  });

  it('marks the page you are on as a soft blue pill with sky ink and a sky icon, no ring and no coloured edge', () => {
    const on = ruleOf(".item[aria-current='page']");
    expect(on).toMatch(/background:\s*var\(--side-on\)/);
    expect(on).toMatch(/color:\s*var\(--side-on-ink\)/);
    expect(on).toMatch(/font-weight:\s*600/);
    expect(on).not.toMatch(/box-shadow|border/);
    expect(ruleOf(".item[aria-current='page'] .icon")).toMatch(/color:\s*var\(--side-on-icon\)/);
    const css = sideCss();
    expect(css).toMatch(/--side-on:\s*var\(--biru-muda\)/);
    expect(css).toMatch(/--side-on-ink:\s*var\(--biru-ink\)/);
    expect(css).toMatch(/--side-on-icon:\s*var\(--sky\)/);
    // Dark: the deep sky pill, warm ink, a lighter sky icon (the board's #0D2F3D, #f2f0ea, #5CC6EC).
    expect(css).toMatch(/\.frame\[data-theme='dark'\] \.side \{[^}]*--side-on:\s*var\(--dark-biru-muda\)[^}]*--side-on-ink:\s*var\(--calm-dark-ink\)[^}]*--side-on-icon:\s*var\(--sky-light\)/);
  });

  it('draws a count as a plain pink number: no chip, no fill, tabular figures, right-aligned', () => {
    const count = ruleOf('.count');
    expect(count).toMatch(/color:\s*var\(--pink-deep\)/);
    expect(count).toMatch(/font-size:\s*12\.5px/);
    expect(count).toMatch(/font-weight:\s*600/);
    expect(count).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(count).toMatch(/text-align:\s*right/);
    expect(count).not.toMatch(/background|box-shadow|padding/);
  });

  it('draws the account card without a box, with a chevron that turns over while the menu is open', () => {
    const card = ruleOf('.card');
    expect(card).toMatch(/background:\s*transparent/);
    expect(card).toMatch(/padding:\s*8px 34px 8px 8px/);
    expect(card).not.toContain('box-shadow');
    expect(ruleOf('.card::after')).toMatch(/width:\s*6px/);
    expect(ruleOf(".card[aria-expanded='true']::after")).toMatch(/rotate\(225deg\)/);
    expect(ruleOf('.card .avatar')).toMatch(/width:\s*36px/);
  });

  it('fills the plan block with no outline, 16px round, and keeps it a link to Billing', () => {
    frame();
    const plan = ruleOf('.plan');
    expect(plan).toMatch(/border-radius:\s*16px/);
    expect(plan).toMatch(/padding:\s*14px 14px 15px/);
    expect(plan).toMatch(/margin-top:\s*auto/);
    expect(plan).not.toContain('box-shadow');
    expect(ruleOf('.plan .planBar')).toMatch(/height:\s*6px/);
    expect(sideCol().getByRole('link', { name: /18 days left/ })).toHaveAttribute('href', '/app/billing');
  });

  it('colours the group titles in muted, which reads on white (the board\'s #78868F is about 3.9:1)', () => {
    expect(ruleOf('.groupTitle')).toMatch(/color:\s*var\(--muted\)/);
    expect(ruleOf('.groupTitle')).toMatch(/margin:\s*18px 12px 6px/);
  });
});

describe('Help in the sidebar, and its shortcut', () => {
  const sideHelp = () => sideCol().getByRole('button', { name: /^Help/ });
  const platform = (value: string) => vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue(value);
  afterEach(() => vi.restoreAllMocks());

  it('has a Help row at the foot of the sidebar, after the plan, that opens the Help panel', () => {
    frame();
    const aside = screen.getByRole('complementary');
    expect(aside.lastElementChild).toBe(sideHelp());
    expect(sideHelp()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(sideHelp());
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeInTheDocument();
    expect(sideHelp()).toHaveAttribute('aria-expanded', 'true');
    // The top bar's Help is still there, and it is not in the nav's links.
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Help' })).toBeInTheDocument();
    expect(links().map((a) => a.textContent)).not.toContain('Help');
  });

  it('names the shortcut Ctrl K off Apple platforms, decided after mount', () => {
    platform('Win32');
    frame();
    expect(sideHelp()).toHaveTextContent('Help' + 'Ctrl K');
    expect(sideHelp()).toHaveAttribute('aria-keyshortcuts', 'Control+K');
  });

  it('names the shortcut ⌘K on a Mac', () => {
    platform('MacIntel');
    frame();
    expect(sideHelp()).toHaveTextContent('Help' + '⌘K');
    expect(sideHelp()).toHaveAttribute('aria-keyshortcuts', 'Meta+K');
  });

  it('draws no hint on the server render, so it cannot mismatch on hydration', async () => {
    const { renderToString } = await import('react-dom/server');
    const html = renderToString(
      <AppFrame displayName="Iman Muqri" avatarUrl={null} plan={PLAN} badges={{ review: 0, questions: 0, leads: 0, orders: 0 }} mode="PERSONAL">
        <p>content</p>
      </AppFrame>,
    );
    expect(html).not.toMatch(/Ctrl K|⌘K/);
    expect(html).toContain('Help');
  });

  it('opens Help on Ctrl+K and swallows the browser\'s own binding', () => {
    platform('Win32');
    frame();
    const press = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(press);
    });
    expect(press.defaultPrevented).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeInTheDocument();
  });

  it('takes the physical K key on a layout whose letter is not k', () => {
    platform('Win32');
    frame();
    const press = new KeyboardEvent('keydown', { key: 'л', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(press);
    });
    expect(press.defaultPrevented).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeInTheDocument();
  });

  it('takes the Command key on a Mac, and not Ctrl', () => {
    platform('MacIntel');
    frame();
    const ctrl = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(ctrl);
    });
    expect(ctrl.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
    const meta = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', metaKey: true, bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(meta);
    });
    expect(meta.defaultPrevented).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeInTheDocument();
  });

  it('ignores other keys, and K with another modifier', () => {
    platform('Win32');
    frame();
    for (const init of [{ key: 'j', code: 'KeyJ', ctrlKey: true }, { key: 'k', code: 'KeyK' }, { key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true }, { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true }, { key: 'k', code: 'KeyJ', ctrlKey: true }]) {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
      act(() => {
        document.dispatchEvent(event);
      });
      expect(event.defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
  });

  it('stops listening when the frame goes', () => {
    platform('Win32');
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { unmount } = frame();
    const keydowns = add.mock.calls.filter(([type]) => type === 'keydown').map(([, fn]) => fn);
    expect(keydowns.length).toBeGreaterThan(0);
    unmount();
    const removed = remove.mock.calls.filter(([type]) => type === 'keydown').map(([, fn]) => fn);
    for (const fn of keydowns) expect(removed).toContain(fn);
    const press = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(false);
  });
});

describe('Saved in the top bar', () => {
  const top = () => screen.getByRole('banner');
  const render_ = (child: React.ReactNode) =>
    render(
      <AppFrame displayName="Iman Muqri" avatarUrl={null} plan={PLAN} badges={{ review: 0, questions: 0, leads: 0, orders: 0 }} mode="BUSINESS">
        {child}
      </AppFrame>,
    );

  it('shows nothing in the top bar on a screen that does not save as you type', () => {
    frame();
    expect(within(top()).queryByRole('status')).toBeNull();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('shows the status of a screen that publishes one, just before Help, and keeps its words and live region', () => {
    render_(<Saves state="saved" />);
    const status = within(top()).getByRole('status');
    expect(status).toHaveTextContent('Saved');
    expect(status).toHaveAttribute('aria-live', 'polite');
    const help = within(top()).getByRole('button', { name: 'Help' });
    expect(status.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status.nextElementSibling).toBe(help);
    // Not in the screen's own area.
    expect(within(screen.getByRole('main')).queryByText('Saved')).toBeNull();
  });

  it('follows the screen between Saving…, Not saved and Saved', () => {
    const view = render_(<Saves state="saving" />);
    expect(within(top()).getByRole('status')).toHaveTextContent('Saving…');
    view.rerender(
      <AppFrame displayName="Iman Muqri" avatarUrl={null} plan={PLAN} badges={{ review: 0, questions: 0, leads: 0, orders: 0 }} mode="BUSINESS">
        <Saves state="failed" />
      </AppFrame>,
    );
    expect(within(top()).getByRole('status')).toHaveTextContent('Not saved');
  });

  it('goes when the screen goes', () => {
    const view = render_(<Saves state="saved" />);
    expect(within(top()).getByRole('status')).toBeInTheDocument();
    view.rerender(
      <AppFrame displayName="Iman Muqri" avatarUrl={null} plan={PLAN} badges={{ review: 0, questions: 0, leads: 0, orders: 0 }} mode="BUSINESS">
        <p>another screen</p>
      </AppFrame>,
    );
    expect(within(top()).queryByRole('status')).toBeNull();
  });

  it('is a 56px bar, with the status on the line of Help: 32px high, 14px/500 in its ink, an 18px icon', () => {
    const css = readFileSync(path.join(import.meta.dirname, 'app-frame.module.css'), 'utf8');
    expect(css).toMatch(/\n\.top \{[^}]*height:\s*56px;/);
    expect(css).not.toContain('64px');
    const status = readFileSync(path.join(import.meta.dirname, '_ui/save-status.module.css'), 'utf8');
    expect(status).toMatch(/\.status \{[^}]*height:\s*32px;[^}]*color:\s*var\(--soft\);[^}]*font-size:\s*14px;[^}]*font-weight:\s*500;/);
    expect(status).toMatch(/\.status svg \{[^}]*width:\s*18px;[^}]*height:\s*18px/);
    // Under 400px the words are visually hidden (kept for a screen reader) so the bar does not overflow.
    expect(status).toMatch(/@media \(max-width: 399px\) \{\s*\.words \{[^}]*position:\s*absolute;[^}]*clip-path:\s*inset\(50%\)/);
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
