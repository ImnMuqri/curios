'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { NavBadges } from '@curios/db-read';
import { Wordmark } from '../_landing/Wordmark.js';
import type { Alert } from './alerts.js';
import { AlertsProvider } from './_ui/alert-slot.js';
import styles from './app-frame.module.css';

type Item = { href: string; label: string; icon: ReactNode; count?: keyof NavBadges; business?: true };

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
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

/**
 * The dashboard's frame: a sidebar of grouped modules with what is waiting in
 * each, and the screen itself. Each screen draws its own header (PageHead),
 * because what sits beside the title differs from screen to screen.
 *
 * The sidebar narrows to an icon rail under 1100px and becomes a scrolling
 * row of icons across the top on a phone; the labels stay in the DOM, so a
 * screen reader still hears every link by name.
 *
 * A client component because it reads the pathname to mark the current
 * module. The layout (a Server Component) passes plain values. IBM Plex Sans
 * comes from the root layout (lib/fonts.ts): next/font read inside a client
 * component names its class differently on the server and in the browser.
 */
export function AppFrame({
  displayName,
  avatarUrl,
  planLabel,
  badges,
  mode,
  alerts = [],
  billingDot = false,
  bare = false,
  children,
}: {
  displayName: string;
  avatarUrl: string | null;
  /** Under the owner's name: "Business plan", "Free trial" and so on. */
  planLabel: string;
  badges: NavBadges;
  /** The Store module is a business page's; a personal page's nav leaves it out. */
  mode: 'PERSONAL' | 'BUSINESS';
  /** The stop states, for each screen's header to show (alerts.ts). */
  alerts?: Alert[];
  /** A red dot on Billing: a trial used up, or a plan that ended. */
  billingDot?: boolean;
  /** No page yet: no frame, only the screen. */
  bare?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '';
  // Onboarding is its own full screen, as the design handoff's Onboarding
  // board draws it, before and after the page exists. Both of those return
  // the screen in the same place, so claiming the page mid-onboarding does
  // not remount it and lose where the owner is.
  if (bare || pathname.startsWith('/app/onboarding')) return <>{children}</>;
  const initials = displayName.split(/\s+/).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase();

  return (
    <div className={styles.frame}>
      <aside className={styles.side}>
        <a href="/app/curios" className={styles.brand}>
          <Wordmark />
          <span className={styles.srOnly}>Curios dashboard</span>
        </a>
        <nav aria-label="Dashboard" className={styles.nav}>
          {GROUPS.map((group) => {
            const items = group.items.filter((item) => !item.business || mode === 'BUSINESS');
            return (
              <div key={group.title} className={styles.group}>
                <p className={styles.groupTitle}>{group.title}</p>
                {items.map((item) => {
                  const count = item.count ? badges[item.count] : 0;
                  return (
                    <a
                      key={item.href}
                      href={item.href}
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
                    </a>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className={styles.who}>
          {avatarUrl ? (
            <img className={styles.avatar} src={avatarUrl} alt="" width={30} height={30} />
          ) : (
            <span className={styles.avatar} aria-hidden="true">{initials}</span>
          )}
          <span className={styles.whoText}>
            <b>{displayName}</b>
            <span>{planLabel}</span>
          </span>
        </div>
      </aside>

      <main className={styles.main}>
        <AlertsProvider alerts={alerts}>{children}</AlertsProvider>
      </main>
    </div>
  );
}
