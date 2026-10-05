'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Wordmark } from '../_landing/Wordmark.js';
import { plexSans } from '../_landing/plex.js';
import styles from './app-frame.module.css';

type Item = { href: string; label: string; icon: ReactNode };

const svg = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
    {path}
  </svg>
);

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Your page',
    items: [
      { href: '/app/curios', label: 'My Curios', icon: svg(<><rect x="3" y="3" width="8" height="10" rx="2" /><rect x="13" y="3" width="8" height="6" rx="2" /><rect x="13" y="11" width="8" height="10" rx="2" /><rect x="3" y="15" width="8" height="6" rx="2" /></>) },
      { href: '/app/review', label: 'Review', icon: svg(<><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></>) },
      { href: '/app/knowledge', label: 'Knowledge', icon: svg(<><path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z" /><path d="M8 7h8M8 11h6" /></>) },
    ],
  },
  {
    title: 'Visitors',
    items: [
      { href: '/app/questions', label: 'Questions', icon: svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />) },
      { href: '/app/leads', label: 'Leads', icon: svg(<><circle cx="9" cy="7" r="4" /><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" /></>) },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/app/billing', label: 'Billing', icon: svg(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>) },
      { href: '/app/settings', label: 'Settings', icon: svg(<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>) },
    ],
  },
];

const TITLES: Record<string, string> = {
  ...Object.fromEntries(GROUPS.flatMap((group) => group.items.map((item) => [item.href, `${group.title} / ${item.label}`]))),
  // Not in the sidebar (Knowledge's Sources tab is the way back to it), but still somewhere.
  '/app/onboarding': 'Your page / Add a source',
};

/**
 * Each screen's colour band, behind its title -- the landing page's bands,
 * from the same palette. Cobalt for your own page, warm where a human needs
 * to act or money is involved (DESIGN.md: kuning's one job), pale blue for
 * the rest, dark for billing.
 */
const BANDS: Record<string, 'BIRU' | 'KUNING' | 'MUDA' | 'INK'> = {
  '/app/curios': 'BIRU',
  '/app/review': 'KUNING',
  '/app/knowledge': 'MUDA',
  '/app/questions': 'MUDA',
  '/app/leads': 'KUNING',
  '/app/billing': 'INK',
  '/app/settings': 'MUDA',
  '/app/onboarding': 'BIRU',
};

/**
 * The dashboard's frame: a sidebar of grouped modules, a top bar with where
 * you are and a way to see your page, and the screen itself.
 *
 * A client component for two reasons: it reads the pathname to mark the
 * current module, and on a phone the sidebar folds behind a menu button with
 * its own open state. The layout (a Server Component) passes plain values.
 */
export function AppFrame({
  displayName,
  handle,
  pendingReview,
  children,
}: {
  displayName: string;
  handle: string;
  pendingReview: number;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  const initials = displayName.split(/\s+/).map((part) => part[0] ?? '').join('').slice(0, 2).toUpperCase();

  return (
    <div className={`${styles.frame} ${plexSans.variable}`}>
      <aside className={styles.side} data-open={open}>
        <a href="/app/curios" className={styles.brand}>
          <Wordmark />
          <span className={styles.srOnly}>Curios dashboard</span>
        </a>
        <nav aria-label="Dashboard" id="dashboard-nav">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <p className={styles.group}>{group.title}</p>
              {group.items.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className={styles.item}
                  aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
                >
                  {item.icon}
                  {item.label}
                  {item.href === '/app/review' && pendingReview > 0 ? (
                    <span className={styles.count}>{pendingReview}</span>
                  ) : null}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.who}>
          <span className={styles.avatar} aria-hidden="true">{initials}</span>
          <span>
            {displayName}
            <small>curios.my/{handle}</small>
          </span>
        </div>
      </aside>

      <div className={styles.main} data-band={BANDS[Object.keys(BANDS).find((href) => pathname.startsWith(href)) ?? '']}>
        <header className={styles.top}>
          <button
            type="button"
            className={styles.menu}
            aria-expanded={open}
            aria-controls="dashboard-nav"
            onClick={() => setOpen((shown) => !shown)}
          >
            Menu
          </button>
          <span className={styles.crumb}>{TITLES[Object.keys(TITLES).find((href) => pathname.startsWith(href)) ?? ''] ?? ''}</span>
          <a className={styles.view} href={`/${handle}`} target="_blank" rel="noreferrer">
            View page
            <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.viewIcon}>
              <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
          </a>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
