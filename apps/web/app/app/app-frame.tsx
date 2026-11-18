'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavBadges } from '@curios/db-read';
import { Wordmark } from '../_landing/Wordmark.js';
import type { Alert } from './alerts.js';
import { BANNER_ALERT_ID } from './alert-ids.js';
import { BELL_COOKIE, bellAlertKey, formatBellSeen, heldTo, type BellSeen } from './bell-seen.js';
import { AlertsProvider } from './_ui/alert-slot.js';
import { NavProgressProvider } from './_ui/nav-progress.js';
import { countLabel } from './_ui/count-label.js';
import { Notifications, WAITING, type Waiting } from './_ui/notifications.js';
import { PhoneMenu } from './_ui/phone-menu.js';
import { announceOverlay, Popover } from './_ui/popover.js';
import { DarkModeRow, ThemeContext } from './_ui/theme-switch.js';
import { paintDocument } from '../_bento/document-color.js';
import { SignOutButton } from './sign-out-button.js';
import { HelpContext, type HelpControl } from './help/help-context.js';
import { HelpPanel } from './help/help-panel.js';
import { THEME_COOKIE, type Theme } from './theme.js';
import styles from './app-frame.module.css';

type Item = { href: string; label: string; icon: ReactNode; count?: keyof NavBadges; business?: true };

const svg = (d: string, className: string | undefined = styles.icon) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path d={d} />
  </svg>
);

/** The nav's icons (a phone's menu draws the same items). */
const PATH = {
  page: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 8h6M9 12h6',
  store: 'M4 9l1.5-5h13L20 9M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
  review: 'M5 12.5l4.5 4.5L19 7.5',
} as const;

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Page',
    items: [
      { href: '/app/curios', label: 'My Curios', icon: svg(PATH.page) },
      { href: '/app/store', label: 'Store', icon: svg(PATH.store), business: true },
    ],
  },
  {
    title: 'Inbox',
    items: [
      { href: '/app/orders', label: 'Orders', count: 'orders', icon: svg('M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h4'), business: true },
      { href: '/app/questions', label: 'Questions', count: 'questions', icon: svg('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01') },
      { href: '/app/leads', label: 'Leads', count: 'leads', icon: svg('M4 20l1.4-4.2A8 8 0 1 1 8.6 19z') },
    ],
  },
  {
    title: 'Knowledge',
    items: [
      { href: '/app/review', label: 'Review', count: 'review', icon: svg(PATH.review) },
      { href: '/app/knowledge', label: 'Facts & sources', icon: svg('M4 5h16v11H8l-4 4zM8 9h8M8 12h5') },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/app/billing', label: 'Billing', icon: svg('M3 6h18v13H3zM3 10h18') },
      { href: '/app/settings', label: 'Settings', icon: svg('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1') },
    ],
  },
];

const BELL = 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5h4';

/** The sidebar's plan block (plan-label.ts planBlock); `glance` is the account menu's one line. */
export type PlanBlock = { name: string; note: string; fill: number | null; glance: string };

export { countLabel };

/** A year, and only for the dashboard, as the theme's cookie. */
function writeBellSeen(value: string) {
  document.cookie = `${BELL_COOKIE}=${value}; Path=/app; Max-Age=31536000; SameSite=Lax`;
}

/**
 * The dashboard's frame (the calm Dash board, 14 Nov 2026): a sidebar on the warm ground -- the
 * wordmark, the account card that opens the account menu, the grouped modules as pill links with
 * what is waiting in each, and the plan at its foot -- a 64px top bar on the same ground (Help, and
 * the bell with what needs you), and the screen on one sheet. Each screen draws its own header (PageHead).
 *
 * Under 1100px the sidebar goes: the top bar starts with the logo, the account menu opens from the
 * avatar at its end (DEVIATIONS 313), and a phone's menu floats at the foot (PhoneMenu).
 *
 * The bell lists what the nav counts and the frame's alerts; there are no other notifications.
 *
 * A client component because it reads the pathname to mark the current module. The layout (a
 * Server Component) passes plain values. Inter comes from the root layout (lib/fonts.ts):
 * next/font read inside a client component names its class differently on the server and in the browser.
 */
export function AppFrame({
  displayName,
  ownerName = null,
  ownerEmail = '',
  usage = null,
  avatarUrl,
  plan,
  badges,
  mode,
  alerts = [],
  billingDot = false,
  bare = false,
  theme: savedTheme = 'system',
  bellSeen: savedBellSeen = { counts: {}, alerts: [] },
  children,
}: {
  /** The page's name: on the sidebar card, and in the account buttons' names. */
  displayName: string;
  /** The owner's own name, at the head of the account menu (the boards' "Lina binti Kamal"), its first word on the card; the page's name when the account has none. */
  ownerName?: string | null;
  /** The sign-in email, under the name in the account menu. */
  ownerEmail?: string;
  /** This month's conversations against the cap, as Billing's meter counts them, for the account menu. */
  usage?: { used: number; cap: number } | null;
  avatarUrl: string | null;
  /** The foot of the sidebar: "Business plan", "18 days left, until 14 Nov", and its bar. */
  plan: PlanBlock;
  badges: NavBadges;
  /** The Store module is a business page's; a personal page's nav leaves it out. */
  mode: 'PERSONAL' | 'BUSINESS';
  /** The stop states, for each screen's header to show (alerts.ts) and for the bell. */
  alerts?: Alert[];
  /** A red dot on Billing: a trial used up, or a plan that ended. */
  billingDot?: boolean;
  /** No page yet: no frame, only the screen. */
  bare?: boolean;
  /** The owner's choice from the account menu's Dark mode (theme.ts); the layout reads it from the cookie. */
  theme?: Theme;
  /** What the bell held when it was last marked read (bell-seen.ts); the layout reads it from the cookie. */
  bellSeen?: BellSeen;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const [theme, setTheme] = useState(savedTheme);
  const [bellSeen, setBellSeen] = useState(savedBellSeen);
  const [pointedAt, setPointedAt] = useState<ReadonlySet<string>>(new Set());
  // Help (design/help/help-chat-design.md): the top bar's Help and the account menu's Help & support
  // open the panel over the current screen, which stays underneath.
  const [helpOpen, setHelpOpen] = useState(false);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  // Help is an overlay too: any open popover (the bell's sheet, the account menu, More) closes as it opens.
  useEffect(() => {
    if (helpOpen) announceOverlay('help');
  }, [helpOpen]);
  const help = useMemo<HelpControl>(
    () => ({ open: helpOpen, show: () => setHelpOpen(true), close: () => setHelpOpen(false), toggle: () => setHelpOpen((was) => !was) }),
    [helpOpen],
  );
  const point = (href: string) => setPointedAt((seen) => (seen.has(href) ? seen : new Set(seen).add(href)));
  const choose = (next: Theme) => {
    setTheme(next);
    // A year, and only for the dashboard. Match device is no cookie at all.
    document.cookie =
      next === 'system'
        ? `${THEME_COOKIE}=; Path=/app; Max-Age=0; SameSite=Lax`
        : `${THEME_COOKIE}=${next}; Path=/app; Max-Age=31536000; SameSite=Lax`;
  };

  // The document behind the frame, in the frame's own ground. A phone shows the document wherever the
  // frame does not reach -- the status bar's strip on a home-screen app, past either end of a scroll --
  // and the site's white there drew a band over a dark dashboard. The body as well as the root: iOS 26
  // Safari colours the strip behind the status bar from the body, and the base stylesheet gives the
  // body the site's paper. Older browsers' bars read theme-color. Read from the frame, so Light, Dark
  // and the device's setting all follow.
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let undo = paintDocument(getComputedStyle(frame).backgroundColor);
    const repaint = () => {
      undo();
      undo = paintDocument(getComputedStyle(frame).backgroundColor);
    };
    const device = window.matchMedia('(prefers-color-scheme: dark)');
    device.addEventListener('change', repaint);
    return () => {
      device.removeEventListener('change', repaint);
      undo();
    };
  }, [theme]);

  // The bell, worked out before the frameless return below so its hook runs on every render.
  const framed = !bare && !pathname.startsWith('/app/onboarding');
  const business = (item: { business?: true }) => !item.business || mode === 'BUSINESS';
  const waiting = WAITING.filter((w) => business(w) && badges[w.key] > 0);
  // What the bell holds now, and what of it is new: a count above what was read, an alert not read.
  const bellNow: BellSeen = {
    counts: Object.fromEntries(waiting.map((w) => [w.key, badges[w.key]])),
    alerts: alerts.map((alert) => bellAlertKey(alert, BANNER_ALERT_ID)),
  };
  const read = heldTo(bellSeen, bellNow);
  // How much of each count came after the read: 3 leads read and 5 waiting is 2 new.
  const newIn = (w: Waiting) => Math.max(0, badges[w.key] - (read.counts[w.key] ?? 0));
  const isNew = {
    waiting: (w: Waiting) => newIn(w) > 0,
    alert: (alert: Alert) => !read.alerts.includes(bellAlertKey(alert, BANNER_ALERT_ID)),
  };
  // The badge counts the new things themselves, so it can pass 99 and read "99+" as the nav's counts do.
  const news = waiting.reduce((sum, w) => sum + newIn(w), 0) + alerts.filter(isNew.alert).length;
  const readCookie = formatBellSeen(read);
  // Keep the cookie held to what is there, so a count that went down and comes back up is news.
  useEffect(() => {
    if (framed && readCookie !== formatBellSeen(bellSeen)) writeBellSeen(readCookie);
  }, [framed, readCookie, bellSeen]);
  const markRead = () => {
    setBellSeen(bellNow);
    writeBellSeen(formatBellSeen(bellNow));
  };

  // Onboarding is its own full screen, as the design handoff's Onboarding
  // board draws it, before and after the page exists. Both of those return
  // the screen in the same place, so claiming the page mid-onboarding does
  // not remount it and lose where the owner is.
  if (!framed) return <>{children}</>;
  const who = ownerName?.trim() || displayName;
  const initial = (name: string) => (name.trim()[0] ?? '').toUpperCase();
  // The card is the page's ("Kek Lina"); under it the owner's first name and the plan, short:
  // "Lina · Business". With no name of its own on the account, the plan stands alone in full.
  const firstName = ownerName?.trim().split(/\s+/)[0] ?? '';
  const planShort = plan.name.replace(/ (plan|page)$/, '');
  const cardLine = firstName ? `${firstName} · ${planShort}` : plan.name;
  const groups = GROUPS.map((group) => ({
    title: group.title,
    items: group.items.filter(business),
  })).filter((group) => group.items.length > 0);
  const items = GROUPS.flatMap((group) => group.items).filter(business);
  // The page's picture, or its initial on a soft rose disc (the board's "K").
  const avatar = avatarUrl ? (
    <img className={styles.avatar} src={avatarUrl} alt="" width={34} height={34} />
  ) : (
    <span className={styles.avatar} aria-hidden="true">
      {initial(displayName)}
    </span>
  );
  // The account menu (the calm Dash board): who you are, this month's conversations and how the
  // plan stands (Manage goes to Billing, so Billing is no row of its own), then Settings, Help &
  // support, Dark mode and Sign out. A disclosure, not an ARIA menu: Dark mode is a switch.
  const account = () => {
    return (
      <>
        <div className={styles.menuHead}>
          <span className={styles.menuAvatar} aria-hidden="true">
            {initial(who)}
          </span>
          <span className={styles.menuText}>
            <b>{who}</b>
            {ownerEmail ? <small>{ownerEmail}</small> : null}
          </span>
        </div>
        <div className={styles.menuPlan}>
          {usage ? (
            <>
              <p>
                <span>Conversations this month</span>
                <b>
                  {usage.used.toLocaleString('en-MY')} / {usage.cap.toLocaleString('en-MY')}
                </b>
              </p>
              <span className={styles.menuBar} aria-hidden="true">
                <i style={{ width: `${usage.cap > 0 ? Math.min(100, (usage.used / usage.cap) * 100) : 0}%` }} />
              </span>
            </>
          ) : null}
          <p>
            <span>{plan.glance}</span>
            <Link href="/app/billing" className={styles.menuManage}>
              Manage
            </Link>
          </p>
        </div>
        <Link href="/app/settings" className={styles.menuRow}>
          Settings
        </Link>
        <button type="button" className={styles.menuRow} data-closes onClick={help.show}>
          Help &amp; support
        </button>
        <DarkModeRow />
        <SignOutButton className={`${styles.menuRow} ${styles.menuOut}`} />
      </>
    );
  };

  return (
    <ThemeContext.Provider value={{ theme, choose }}>
     <HelpContext.Provider value={help}>
      <div ref={frameRef} className={styles.frame} data-theme={theme} data-help-open={helpOpen || undefined} data-laptop-scale>
        <aside className={styles.side}>
          <Link href="/app/curios" className={styles.brand}>
            <Wordmark />
            <span className={styles.srOnly}>Curios dashboard</span>
          </Link>
          {/* The account card: the page, and whose and on what plan; it opens the account menu. */}
          <div className={styles.cardSlot}>
            <Popover
              // Its name says all the card shows, the line under the name too (WCAG 2.5.3, label in name).
              label={`Account, ${displayName}, ${cardLine}`}
              align="start"
              buttonClassName={styles.card}
              panelClassName={styles.accountPanel}
              button={
                <>
                  {avatar}
                  <span className={styles.cardText}>
                    <b>{displayName}</b>
                    <small>{cardLine}</small>
                  </span>
                </>
              }
            >
              {account()}
            </Popover>
          </div>
          <nav aria-label="Dashboard" className={styles.nav}>
            {groups.map((group) => (
              <div key={group.title} className={styles.group}>
                <p className={styles.groupTitle}>{group.title}</p>
                {group.items.map((item) => {
                  const count = item.count ? badges[item.count] : 0;
                  // Link, not <a>: a client-side navigation fetches only the screen, where a full
                  // load re-sent the whole document, its styles and the frame (about 85 kB and a
                  // re-hydrate per click, measured on a busy shop). The counts come with the
                  // frame, so they refresh with any change made (router.refresh) or a reload.
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      // The whole screen, its data and its code, is fetched once the owner points
                      // at it (hover, touch or focus), so the click has little left to wait for.
                      // Not before: prefetching all nine on every load would render each one.
                      prefetch={pointedAt.has(item.href) ? true : null}
                      onMouseEnter={() => point(item.href)}
                      onTouchStart={() => point(item.href)}
                      onFocus={() => point(item.href)}
                      className={styles.item}
                      aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
                    >
                      {item.icon}
                      <span className={styles.label}>{item.label}</span>
                      {count > 0 ? <span className={styles.count}>{countLabel(count)}</span> : null}
                      {billingDot && item.href === '/app/billing' ? (
                        <span className={styles.dot}>
                          <span className={styles.srOnly}>, needs you</span>
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <Link href="/app/billing" className={styles.plan}>
            <b>{plan.name.replace(/ plan$/, '')}</b>
            <span>{plan.note}</span>
            {plan.fill !== null ? (
              <span className={styles.planBar} aria-hidden="true">
                <i style={{ width: `${Math.round(plan.fill * 100)}%` }} />
              </span>
            ) : null}
          </Link>
        </aside>

        <div className={styles.column}>
          <header className={styles.top}>
            {/* A phone has no sidebar: the logo starts its top bar. */}
            <Link href="/app/curios" className={styles.topBrand}>
              <Wordmark />
              <span className={styles.srOnly}>Curios dashboard</span>
            </Link>
            <button type="button" className={styles.help} data-help-opener aria-expanded={helpOpen} onClick={help.toggle}>
              Help
            </button>
            <Popover
              label={news > 0 ? `Notifications, ${countLabel(news)} new` : 'Notifications'}
              buttonClassName={styles.iconButton}
              panelClassName={styles.notifications}
              scrimClassName={styles.notifyScrim}
              button={
                <>
                  {svg(BELL, styles.topIcon)}
                  {news > 0 ? (
                    <u className={styles.unread} aria-hidden="true">
                      {countLabel(news)}
                    </u>
                  ) : null}
                </>
              }
            >
              <Notifications waiting={waiting} alerts={alerts} badges={badges} isNew={isNew} news={news} markRead={markRead} business={mode === 'BUSINESS'} />
            </Popover>
            {/* Under 1100px there is no sidebar, so no card: the account menu opens from the avatar here (DEVIATIONS 313). */}
            <div className={styles.phoneAccount}>
              <Popover label={`Account, ${displayName}`} buttonClassName={styles.account} panelClassName={styles.phonePanel} button={avatar}>
                {account()}
              </Popover>
            </div>
          </header>
          <main className={styles.sheet}>
            <NavProgressProvider>
              <AlertsProvider alerts={alerts}>{children}</AlertsProvider>
            </NavProgressProvider>
          </main>
        </div>

        <PhoneMenu pathname={pathname} items={items} badges={badges} billingDot={billingDot} className={styles.phoneMenu} />
        {helpOpen ? <HelpPanel firstName={ownerName?.trim().split(/\s+/)[0] || null} email={ownerEmail ?? null} onClose={closeHelp} /> : null}
      </div>
     </HelpContext.Provider>
    </ThemeContext.Provider>
  );
}
