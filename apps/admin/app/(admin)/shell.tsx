'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { NavCounts } from '@curios/db-read/admin';
import { SignOut } from './sign-out.js';
import styles from './shell.module.css';

export type NavKey = 'overview' | 'pages' | 'ai' | 'sources' | 'payments' | 'reports' | 'controls' | 'audit';

// The board's groups.
const GROUPS: {
  label: string;
  items: { key: NavKey; label: string; href: string; icon: string; count?: keyof NavCounts }[];
}[] = [
  {
    label: 'Look',
    items: [
      { key: 'overview', label: 'Overview', href: '/', icon: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z' },
      {
        key: 'pages',
        label: 'Pages',
        href: '/pages',
        icon: 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 8h6M9 12h6',
      },
      { key: 'ai', label: 'AI & usage', href: '/ai', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
    ],
  },
  {
    label: 'Run',
    items: [
      {
        key: 'sources',
        label: 'Reading sources',
        href: '/sources',
        icon: 'M4 5h16M4 12h10M4 19h16M18 9l3 3-3 3',
        count: 'failedSources',
      },
      {
        key: 'payments',
        label: 'Payments',
        href: '/payments',
        icon: 'M3 6h18v12H3zM3 10h18M7 15h3',
        count: 'failedWebhooks',
      },
      {
        key: 'reports',
        label: 'Reports',
        href: '/reports',
        icon: 'M5 21V4M5 4h11l-2 4 2 4H5',
        count: 'openReports',
      },
    ],
  },
  {
    label: 'Change',
    items: [
      {
        key: 'controls',
        label: 'Controls',
        href: '/controls',
        icon: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
      },
      { key: 'audit', label: 'Audit log', href: '/audit', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h4' },
    ],
  },
];

function keyOf(pathname: string | null): NavKey | null {
  if (!pathname || pathname === '/') return 'overview';
  if (pathname.startsWith('/pages')) return 'pages';
  if (pathname.startsWith('/ai')) return 'ai';
  if (pathname.startsWith('/sources')) return 'sources';
  if (pathname.startsWith('/payments')) return 'payments';
  if (pathname.startsWith('/reports')) return 'reports';
  if (pathname.startsWith('/controls')) return 'controls';
  if (pathname.startsWith('/audit')) return 'audit';
  return null;
}

/** The admin frame: dark sidebar, the Production strip, then the screen. `current` defaults to the URL. */
export function Shell({
  adminName,
  current,
  counts,
  children,
}: {
  adminName: string;
  current?: NavKey;
  /** The sidebar's counts, each hidden at 0. */
  counts?: NavCounts;
  children?: ReactNode;
}) {
  const pathname = usePathname();
  const active = current ?? keyOf(pathname);

  return (
    <div className={styles.root}>
      <aside className={styles.side} aria-label="Admin navigation">
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            curi
            <span className={styles.mo}>
              <svg viewBox="0 0 40 40">
                <circle className={styles.moRing} cx="20" cy="20" r="15.6" />
                <g className={styles.moEyes}>
                  <circle cx="14.8" cy="16" r="4.1" />
                  <circle cx="25.2" cy="16" r="4.1" />
                </g>
              </svg>
            </span>
            s
          </span>
          <span className={styles.tag}>Admin</span>
        </div>
        <nav className={styles.nav}>
          {GROUPS.map((group) => (
            <div key={group.label} className={styles.group}>
              <p className={styles.grp}>{group.label}</p>
              {group.items.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className={styles.link}
                  aria-current={active === item.key ? 'page' : undefined}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d={item.icon} />
                  </svg>
                  {item.label}
                  {item.count && counts && counts[item.count] > 0 ? <em>{counts[item.count]}</em> : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className={styles.me}>
          <b>{adminName}</b>
          <span>Admin · email and password</span>
          <SignOut />
        </div>
      </aside>
      <main className={styles.main}>
        <div className={styles.env}>
          <i />
          Production. Changes here reach every page on Curios.
        </div>
        {children}
      </main>
    </div>
  );
}
