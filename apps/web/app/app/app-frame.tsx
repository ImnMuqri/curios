'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { NavBadges } from '@curios/db-read';
import { Wordmark } from '../_landing/Wordmark.js';
import type { Alert } from './alerts.js';
import { AlertsProvider } from './_ui/alert-slot.js';
import { NavProgressProvider } from './_ui/nav-progress.js';
import { Popover } from './_ui/popover.js';
import { ThemeContext, ThemeSwitch } from './_ui/theme-switch.js';
import { paintDocument } from '../_bento/document-color.js';
import { SignOutButton } from './sign-out-button.js';
import { THEME_COOKIE, type Theme } from './theme.js';
import styles from './app-frame.module.css';

type Item = { href: string; label: string; icon: ReactNode; count?: keyof NavBadges; business?: true };

const svg = (d: string, className: string | undefined = styles.icon) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path d={d} />
  </svg>
);

/** The nav's icons, shared with a phone's bottom menu. */
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

const ICON = {
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5h4',
  chevron: 'M7 10l5 5 5-5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01',
  signOut: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
  ...PATH,
  inbox: 'M4 13l2.5-8h11L20 13M4 13v6h16v-6M4 13h4.5l1 2.5h5l1-2.5H20',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
} as const;

/** What the bell lists for each count in the nav: the module's waiting work, in a line. */
const WAITING: { key: keyof NavBadges; href: string; say: (n: number) => string; business?: true }[] = [
  { key: 'orders', href: '/app/orders', say: (n) => `${n} ${n === 1 ? 'receipt' : 'receipts'} to check`, business: true },
  { key: 'questions', href: '/app/questions', say: (n) => `${n} new ${n === 1 ? 'question' : 'questions'}` },
  { key: 'leads', href: '/app/leads', say: (n) => `${n} new ${n === 1 ? 'lead' : 'leads'}` },
  { key: 'review', href: '/app/review', say: (n) => `${n} ${n === 1 ? 'fact' : 'facts'} to review` },
];

/** The three inboxes: one tab on a phone's bottom menu, a row of their own at the top of each. */
const INBOX = ['/app/orders', '/app/questions', '/app/leads'];

/** What a phone's More sheet holds: the modules the bottom menu has no tab for. */
const MORE = ['/app/knowledge', '/app/billing', '/app/settings'];

/** The sidebar's plan block (plan-label.ts planBlock); `glance` is the account menu's one line. */
export type PlanBlock = { name: string; note: string; fill: number | null; glance: string };

/** Help goes to the support address the alerts and legal pages give: there is no help centre yet. */
const SUPPORT = 'mailto:support@curios.my';

/**
 * The dashboard's frame (Dashboard v2, 29 Oct 2026): a sidebar on a grey ground -- search, the
 * grouped modules with what is waiting in each, and the plan -- a 64px top bar on the same grey
 * (where you are, the theme's three choices, what needs you, the account), and the screen on one white sheet
 * whose top-left corner alone is rounded. Each screen draws its own header (PageHead).
 *
 * The sidebar narrows to an icon rail under 1100px and becomes a scrolling row of icons across
 * the top on a phone, where the top bar goes and the account menu (with the theme in it) ends
 * that row. The labels stay in the DOM, so a screen reader still hears every link by name.
 *
 * Search filters the modules by name and Enter opens the first one left; `/` jumps to it from
 * anywhere that is not a field (owner decision 2026-10-29: no search across the inboxes yet).
 * The bell lists what the nav counts and the frame's alerts; there are no other notifications.
 *
 * A client component because it reads the pathname to mark the current module. The layout (a
 * Server Component) passes plain values. IBM Plex Sans comes from the root layout (lib/fonts.ts):
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
  children,
}: {
  /** The page's name: the breadcrumb starts with it. */
  displayName: string;
  /** The owner's own name, on the account button (the boards' "Lina binti Kamal"); the page's name when the account has none. */
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
  /** The owner's choice from the top bar's theme menu (theme.ts); the layout reads it from the cookie. */
  theme?: Theme;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [theme, setTheme] = useState(savedTheme);
  const [query, setQuery] = useState('');
  const [more, setMore] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const [pointedAt, setPointedAt] = useState<ReadonlySet<string>>(new Set());
  const point = (href: string) => setPointedAt((seen) => (seen.has(href) ? seen : new Set(seen).add(href)));
  const choose = (next: Theme) => {
    setTheme(next);
    // A year, and only for the dashboard. Match device is no cookie at all.
    document.cookie =
      next === 'system'
        ? `${THEME_COOKIE}=; Path=/app; Max-Age=0; SameSite=Lax`
        : `${THEME_COOKIE}=${next}; Path=/app; Max-Age=31536000; SameSite=Lax`;
  };

  // `/` puts the cursor in search, unless the owner is typing somewhere already.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      search.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // The More sheet closes on Escape and whenever the screen changes (a page picked in it).
  useEffect(() => {
    if (!more) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMore(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [more]);
  useEffect(() => setMore(false), [pathname]);

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

  // Onboarding is its own full screen, as the design handoff's Onboarding
  // board draws it, before and after the page exists. Both of those return
  // the screen in the same place, so claiming the page mid-onboarding does
  // not remount it and lose where the owner is.
  if (bare || pathname.startsWith('/app/onboarding')) return <>{children}</>;
  const who = ownerName?.trim() || displayName;
  const initials = who.split(/\s+/).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase();
  // Under the name on the account button: "Kek Lina · Business". When the page is named after its
  // owner (or the account has no name of its own) the page would only repeat the line above, so the
  // plan stands alone in full: "Business plan".
  const pageIsWho = displayName.trim().toLowerCase() === who.toLowerCase();
  const accountLine = pageIsWho ? plan.name : `${displayName} · ${plan.name.replace(/ (plan|page)$/, '')}`;
  const business = (item: { business?: true }) => !item.business || mode === 'BUSINESS';
  const needle = query.trim().toLowerCase();
  const groups = GROUPS.map((group) => ({
    title: group.title,
    items: group.items.filter((item) => business(item) && (!needle || item.label.toLowerCase().includes(needle))),
  })).filter((group) => group.items.length > 0);
  const here = GROUPS.flatMap((group) => group.items).find((item) => pathname.startsWith(item.href));
  const waiting = WAITING.filter((w) => business(w) && badges[w.key] > 0);
  const items = GROUPS.flatMap((group) => group.items).filter(business);
  const inboxes = items.filter((item) => INBOX.includes(item.href));
  const inInbox = inboxes.some((item) => pathname.startsWith(item.href));
  const inboxCount = inboxes.reduce((sum, item) => sum + (item.count ? badges[item.count] : 0), 0);
  const moreItems = items.filter((item) => MORE.includes(item.href));
  const inMore = moreItems.some((item) => pathname.startsWith(item.href));
  const tab = (href: string) => items.find((item) => item.href === href);
  const news = waiting.length + alerts.length;
  const avatar = avatarUrl ? (
    <img className={styles.avatar} src={avatarUrl} alt="" width={28} height={28} />
  ) : (
    <span className={styles.avatar} aria-hidden="true">
      {initials}
    </span>
  );
  // The account menu, "plan at a glance" (29 Oct 2026 boards): who you are, this month's
  // conversations and how the plan stands (Manage goes to Billing, so Billing is no row of its own),
  // then Settings, Help & support and Sign out. On a phone, where the top bar has no room for it,
  // the theme switch sits under who you are.
  const account = () => {
    const item = { role: 'menuitem' } as const;
    return (
      <>
        <div className={styles.menuHead}>
          {avatarUrl ? (
            <img className={styles.menuAvatar} src={avatarUrl} alt="" width={38} height={38} />
          ) : (
            <span className={styles.menuAvatar} aria-hidden="true">
              {initials}
            </span>
          )}
          <span className={styles.menuText}>
            <b>{who}</b>
            {ownerEmail ? <small>{ownerEmail}</small> : null}
          </span>
        </div>
        <div className={styles.menuPhoneTheme}>
          <ThemeSwitch />
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
            <Link href="/app/billing" className={styles.menuManage} {...item}>
              Manage
            </Link>
          </p>
        </div>
        <Link href="/app/settings" className={styles.menuRow} {...item}>
          {svg(ICON.settings, styles.menuIcon)}
          Settings
        </Link>
        <a href={SUPPORT} className={styles.menuRow} {...item}>
          {svg(ICON.help, styles.menuIcon)}
          Help &amp; support
        </a>
        <span className={styles.menuRule} aria-hidden="true" />
        <SignOutButton className={`${styles.menuRow} ${styles.menuOut}`} icon={svg(ICON.signOut, styles.menuIcon)} {...item} />
      </>
    );
  };

  return (
    <ThemeContext.Provider value={{ theme, choose }}>
      <div ref={frameRef} className={styles.frame} data-theme={theme}>
        <aside className={styles.side}>
          <Link href="/app/curios" className={styles.brand}>
            <Wordmark />
            <span className={styles.srOnly}>Curios dashboard</span>
          </Link>
          <label className={styles.search}>
            {svg(ICON.search, styles.searchIcon)}
            <input
              ref={search}
              type="search"
              placeholder="Search"
              aria-label="Search the dashboard"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('');
                if (event.key !== 'Enter') return;
                const first = groups[0]?.items[0];
                if (!first) return;
                event.preventDefault();
                setQuery('');
                router.push(first.href);
              }}
            />
            <kbd aria-hidden="true">/</kbd>
          </label>
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
                      {count > 0 ? <span className={styles.count}>{count}</span> : null}
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
            {groups.length === 0 ? <p className={styles.noMatch}>Nothing called that</p> : null}
          </nav>
          <Link href="/app/billing" className={styles.plan}>
            <b>{plan.name}</b>
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
            <p className={styles.crumb}>
              {displayName}
              {here ? (
                <>
                  <i aria-hidden="true">/</i>
                  <b>{here.label}</b>
                </>
              ) : null}
            </p>
            <a className={styles.help} href={SUPPORT}>
              Help
            </a>
            <ThemeSwitch className={styles.topTheme} />
            <Popover
              label={news > 0 ? `Notifications, ${news} new` : 'Notifications'}
              buttonClassName={styles.iconButton}
              button={
                <>
                  {svg(ICON.bell, styles.topIcon)}
                  {news > 0 ? (
                    <u className={styles.unread} aria-hidden="true">
                      {news}
                    </u>
                  ) : null}
                </>
              }
            >
              {news === 0 ? <p className={styles.menuEmpty}>Nothing needs you right now.</p> : null}
              {waiting.map((w) => (
                <Link key={w.key} href={w.href} className={styles.menuItem}>
                  {w.say(badges[w.key])}
                </Link>
              ))}
              {alerts.map((alert) =>
                alert.action ? (
                  <Link key={alert.id} href={alert.action.href} className={styles.menuAlert} data-tone={alert.tone}>
                    <b>{alert.title}</b>
                    <span>{alert.text}</span>
                  </Link>
                ) : (
                  <p key={alert.id} className={styles.menuAlert} data-tone={alert.tone}>
                    <b>{alert.title}</b>
                    <span>{alert.text}</span>
                  </p>
                ),
              )}
            </Popover>
            <span className={styles.divider} aria-hidden="true" />
            <Popover
              label="Account"
              menu
              buttonClassName={styles.account}
              panelClassName={styles.accountPanel}
              button={
                <>
                  {avatar}
                  <span className={styles.accountWho}>
                    <b>{who}</b>
                    <small>{accountLine}</small>
                  </span>
                  {svg(ICON.chevron, styles.chevron)}
                </>
              }
            >
              {account()}
            </Popover>
          </header>
          <main className={styles.sheet}>
            {/* On a phone the three inboxes share one tab below, so each starts with a row to switch between them. */}
            {inInbox ? (
              <nav aria-label="Inbox" className={styles.inboxTabs}>
                {inboxes.map((item) => {
                  const count = item.count ? badges[item.count] : 0;
                  return (
                    <Link key={item.href} href={item.href} aria-current={pathname.startsWith(item.href) ? 'page' : undefined}>
                      {item.label}
                      {count > 0 ? <em>{count}</em> : null}
                    </Link>
                  );
                })}
              </nav>
            ) : null}
            <NavProgressProvider>
              <AlertsProvider alerts={alerts}>{children}</AlertsProvider>
            </NavProgressProvider>
          </main>
        </div>

        {/* A phone's menu (29 Oct 2026 boards): a pill floating at the foot, five tabs, and More's sheet above it. */}
        <nav aria-label="Main navigation" className={styles.dock} data-more={more || undefined}>
          {more ? <button type="button" className={styles.scrim} aria-label="Close" tabIndex={-1} onClick={() => setMore(false)} /> : null}
          <Link href="/app/curios" className={styles.dockTab} aria-current={pathname.startsWith('/app/curios') ? 'page' : undefined}>
            {svg(ICON.page, styles.dockIcon)}
            <span>Page</span>
          </Link>
          {tab('/app/store') ? (
            <Link href="/app/store" className={styles.dockTab} aria-current={pathname.startsWith('/app/store') ? 'page' : undefined}>
              {svg(ICON.store, styles.dockIcon)}
              <span>Store</span>
            </Link>
          ) : null}
          <Link href={inboxes[0]!.href} className={styles.dockTab} aria-current={inInbox ? 'page' : undefined}>
            {svg(ICON.inbox, styles.dockIcon)}
            <span>Inbox</span>
            {inboxCount > 0 ? <u className={styles.dockCount}>{inboxCount}</u> : null}
          </Link>
          <Link href="/app/review" className={styles.dockTab} aria-current={pathname.startsWith('/app/review') ? 'page' : undefined}>
            {svg(ICON.review, styles.dockIcon)}
            <span>Review</span>
            {badges.review > 0 ? <u className={styles.dockCount}>{badges.review}</u> : null}
          </Link>
          <button
            type="button"
            className={styles.dockTab}
            aria-expanded={more}
            aria-controls="dock-more"
            data-on={inMore || more || undefined}
            onClick={() => setMore((was) => !was)}
          >
            {svg(ICON.more, styles.dockIcon)}
            <span>More</span>
            {billingDot ? <i className={styles.dockDot} aria-hidden="true" /> : null}
          </button>
          <div id="dock-more" className={styles.moreSheet} hidden={!more}>
            <span className={styles.grab} aria-hidden="true" />
            {['Knowledge', 'Account'].map((title) => {
              const rows = moreItems.filter((item) => GROUPS.find((group) => group.title === title)!.items.includes(item));
              return rows.length > 0 ? (
                <div key={title}>
                  <p>{title}</p>
                  {rows.map((item) => (
                    <Link key={item.href} href={item.href} aria-current={pathname.startsWith(item.href) ? 'page' : undefined} onClick={() => setMore(false)}>
                      {item.icon}
                      {item.label}
                      {billingDot && item.href === '/app/billing' ? (
                        <span className={styles.dot}>
                          <span className={styles.srOnly}>, needs you</span>
                        </span>
                      ) : null}
                    </Link>
                  ))}
                </div>
              ) : null;
            })}
          </div>
        </nav>
      </div>
    </ThemeContext.Provider>
  );
}
