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
import { SignOutButton } from './sign-out-button.js';
import { THEME_COOKIE, type Theme } from './theme.js';
import styles from './app-frame.module.css';

type Item = { href: string; label: string; icon: ReactNode; count?: keyof NavBadges; business?: true };

const svg = (d: string, className: string | undefined = styles.icon) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path d={d} />
  </svg>
);

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Page',
    items: [
      { href: '/app/curios', label: 'My Curios', icon: svg('M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 8h6M9 12h6') },
      { href: '/app/store', label: 'Store', icon: svg('M4 9l1.5-5h13L20 9M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z'), business: true },
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
      { href: '/app/review', label: 'Review', count: 'review', icon: svg('M5 12.5l4.5 4.5L19 7.5') },
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
  system: 'M4 5h16v11H4zM9 20h6M12 16v4',
  light: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  dark: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5h4',
  chevron: 'M7 10l5 5 5-5',
} as const;

/** What the bell lists for each count in the nav: the module's waiting work, in a line. */
const WAITING: { key: keyof NavBadges; href: string; say: (n: number) => string; business?: true }[] = [
  { key: 'orders', href: '/app/orders', say: (n) => `${n} ${n === 1 ? 'receipt' : 'receipts'} to check`, business: true },
  { key: 'questions', href: '/app/questions', say: (n) => `${n} new ${n === 1 ? 'question' : 'questions'}` },
  { key: 'leads', href: '/app/leads', say: (n) => `${n} new ${n === 1 ? 'lead' : 'leads'}` },
  { key: 'review', href: '/app/review', say: (n) => `${n} ${n === 1 ? 'fact' : 'facts'} to review` },
];

/** The sidebar's plan block (plan-label.ts planBlock). */
export type PlanBlock = { name: string; note: string; fill: number | null };

/**
 * The dashboard's frame (Dashboard v2, 29 Oct 2026): a sidebar on a grey ground -- search, the
 * grouped modules with what is waiting in each, and the plan -- a 64px top bar on the same grey
 * (where you are, the theme, what needs you, the account), and the screen on one white sheet
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
  displayName: string;
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

  // Onboarding is its own full screen, as the design handoff's Onboarding
  // board draws it, before and after the page exists. Both of those return
  // the screen in the same place, so claiming the page mid-onboarding does
  // not remount it and lose where the owner is.
  if (bare || pathname.startsWith('/app/onboarding')) return <>{children}</>;
  const initials = displayName.split(/\s+/).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase();
  const business = (item: { business?: true }) => !item.business || mode === 'BUSINESS';
  const needle = query.trim().toLowerCase();
  const groups = GROUPS.map((group) => ({
    title: group.title,
    items: group.items.filter((item) => business(item) && (!needle || item.label.toLowerCase().includes(needle))),
  })).filter((group) => group.items.length > 0);
  const here = GROUPS.flatMap((group) => group.items).find((item) => pathname.startsWith(item.href));
  const waiting = WAITING.filter((w) => business(w) && badges[w.key] > 0);
  const news = waiting.length + alerts.length;
  const avatar = avatarUrl ? (
    <img className={styles.avatar} src={avatarUrl} alt="" width={28} height={28} />
  ) : (
    <span className={styles.avatar} aria-hidden="true">
      {initials}
    </span>
  );
  const accountLinks = (
    <>
      <Link href="/app/settings" className={styles.menuItem}>
        Settings
      </Link>
      <Link href="/app/billing" className={styles.menuItem}>
        Billing
      </Link>
      <div className={styles.menuSignOut}>
        <SignOutButton />
      </div>
    </>
  );

  return (
    <ThemeContext.Provider value={{ theme, choose }}>
      <div className={styles.frame} data-theme={theme}>
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
          {/* A phone has no top bar: the account, and the theme with it, end the row of icons. */}
          <div className={styles.phoneAccount}>
            <Popover label="Account and theme" buttonClassName={styles.phoneAccountButton} button={avatar}>
              <p className={styles.menuWho}>{displayName}</p>
              <ThemeSwitch className={styles.menuTheme} />
              {accountLinks}
            </Popover>
          </div>
        </aside>

        <div className={styles.column}>
          <header className={styles.top}>
            <p className={styles.crumb}>
              {displayName}
              {here ? (
                <>
                  <i aria-hidden="true">/</i>
                  <b>{here.label}</b>
                </>
              ) : null}
            </p>
            <Popover label="Theme" buttonClassName={styles.iconButton} button={svg(ICON[theme], styles.topIcon)}>
              <ThemeSwitch className={styles.menuTheme} />
            </Popover>
            <Popover
              label={news > 0 ? `Notifications, ${news} new` : 'Notifications'}
              buttonClassName={styles.iconButton}
              button={
                <>
                  {svg(ICON.bell, styles.topIcon)}
                  {news > 0 ? <u className={styles.unread} /> : null}
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
            <Popover
              label="Account"
              buttonClassName={styles.account}
              button={
                <>
                  {avatar}
                  <span className={styles.accountName}>{displayName}</span>
                  {svg(ICON.chevron, styles.chevron)}
                </>
              }
            >
              {accountLinks}
            </Popover>
          </header>
          <main className={styles.sheet}>
            <NavProgressProvider>
              <AlertsProvider alerts={alerts}>{children}</AlertsProvider>
            </NavProgressProvider>
          </main>
        </div>
      </div>
    </ThemeContext.Provider>
  );
}
