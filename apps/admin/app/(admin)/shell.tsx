'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SignOut } from './sign-out.js';
import styles from './shell.module.css';

export type NavKey = 'overview' | 'pages' | 'audit';

// Part 1 builds three screens. The board's other items (AI & usage, Reading
// sources, Payments, Reports, Controls) arrive with their screens; the `Run`
// group is omitted until it has an item.
const GROUPS: { label: string; items: { key: NavKey; label: string; href: string; icon: string }[] }[] = [
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
    ],
  },
  {
    label: 'Change',
    items: [{ key: 'audit', label: 'Audit log', href: '/audit', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h4' }],
  },
];

function keyOf(pathname: string | null): NavKey | null {
  if (!pathname || pathname === '/') return 'overview';
  if (pathname.startsWith('/pages')) return 'pages';
  if (pathname.startsWith('/audit')) return 'audit';
  return null;
}

/** The admin frame: dark sidebar, the Production strip, then the screen. `current` defaults to the URL. */
export function Shell({ adminName, current, children }: { adminName: string; current?: NavKey; children?: ReactNode }) {
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
