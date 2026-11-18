'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import type { NavBadges } from '@curios/db-read';
import { countLabel } from './count-label.js';
import { Popover } from './popover.js';
import styles from './phone-menu.module.css';

/** A module as the menu draws it: the sidebar's own item (its icon, and the count it shows). */
export type MenuItem = { href: string; label: string; icon: ReactNode; count?: keyof NavBadges };

/** The four modules with a tab of their own, and the tab's name (the board's "Page" for My Curios). */
const TABS: Record<string, string> = { '/app/curios': 'Page', '/app/store': 'Store', '/app/orders': 'Orders', '/app/questions': 'Questions' };

/** A tab without its label is a 48px circle (13px either side of a 22px icon); the tabs sit 2px apart, 6px in from the pill's edge. */
const TAB = 48;
const GAP = 2;
const PAD = 6;
/** Near the top the menu always shows; a scroll smaller than this is jitter, not a direction. */
const NEAR_TOP = 80;
const JITTER = 8;

const at = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The More tab's icon: three dots in a row, stood up while the sheet is open (the board's .more). */
const dots = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="5" cy="12" r="1.3" />
    <circle cx="12" cy="12" r="1.3" />
    <circle cx="19" cy="12" r="1.3" />
  </svg>
);

/**
 * A phone's menu, under 1100px where the sidebar goes (the calm Dash board's .dock): a pill floating
 * at the foot with Page, Store, Orders, Questions and More, More opening a sheet of the rest above it.
 *
 * Only the tab you are on shows its label, on a black pill. One spring (CSS, cubic-bezier(.3, 1.3, .5, 1),
 * near the board's scripted spring) opens the label and moves the pill; the pill's two edges are separate
 * registered properties, so the edge it moves toward arrives first and the other follows. The pill's
 * place is worked out from the tabs' resting widths, not read mid-spring.
 *
 * It slips away on a scroll down and comes back on a scroll up, never near the top of the page or
 * while More is open. More's sheet is a Popover: Escape, a link or a tap on the dimmed page closes
 * it, and the tap goes no further than the scrim.
 */
export function PhoneMenu({
  pathname,
  items,
  badges,
  billingDot,
  className,
}: {
  pathname: string;
  /** The modules this page has, in the sidebar's order (a personal page has no Store or Orders). */
  items: MenuItem[];
  badges: NavBadges;
  /** Billing needs you: a red dot on its row in the sheet. */
  billingDot: boolean;
  /** The frame's hook on the menu (it hides while Help fills a phone). */
  className?: string | undefined;
}) {
  const tabs = items.filter((item) => item.href in TABS);
  const rest = items.filter((item) => !(item.href in TABS));
  const on = tabs.findIndex((item) => at(pathname, item.href));
  // A page with no tab of its own is one of More's (the board puts the pill there).
  const moreOn = on < 0;

  const nav = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ l: number; r: number; dir: 'left' | 'right' } | null>(null);
  const [away, setAway] = useState(false);

  // Where the pill rests: past the circles before the tab you are on, as wide as that tab with its label.
  const place = useCallback(() => {
    const root = nav.current;
    if (!root) return;
    const all = [...root.querySelectorAll<HTMLElement>('[data-tab]')];
    const index = all.findIndex((tab) => tab.hasAttribute('data-on'));
    if (index < 0) return;
    const label = all[index]!.querySelector<HTMLElement>('[data-label]');
    const l = PAD + index * (TAB + GAP);
    const r = l + TAB + Math.ceil(label?.getBoundingClientRect().width ?? 0);
    setPill((was) => (was && was.l === l && was.r === r ? was : { l, r, dir: was && r < was.r ? 'left' : 'right' }));
  }, []);
  // Again when the page changes, or the tabs do (a page turned Business or Personal without a navigation).
  const tabKey = items.map((item) => item.href).join(' ');
  useLayoutEffect(() => place(), [place, pathname, tabKey]);
  useEffect(() => {
    window.addEventListener('resize', place);
    // The label's width changes once Inter has loaded.
    void document.fonts?.ready.then(place);
    return () => window.removeEventListener('resize', place);
  }, [place]);

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y <= NEAR_TOP) {
        last = y;
        setAway(false);
        return;
      }
      if (Math.abs(y - last) < JITTER) return;
      const down = y > last;
      last = y;
      if (down && nav.current?.querySelector('[aria-expanded="true"]')) return;
      setAway(down);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => setAway(false), [pathname]);

  const badge = (count: number) =>
    count > 0 ? (
      <span className={styles.badge} aria-hidden="true">
        {countLabel(count)}
      </span>
    ) : null;
  // A count is drawn on the icon, apart from the word, so the name says both in one run: "Orders, 99+".
  const named = (label: string, ...extra: (string | false)[]) => {
    const more = extra.filter(Boolean);
    return more.length > 0 ? [label, ...more].join(', ') : undefined;
  };

  return (
    <nav
      ref={nav}
      aria-label="Menu"
      className={className ? `${styles.dock} ${className}` : styles.dock}
      data-away={away || undefined}
      // A hidden menu comes back when the keyboard reaches it.
      onFocus={() => setAway(false)}
      data-ready={pill ? '' : undefined}
      data-dir={pill?.dir}
    >
      <span className={styles.ground} aria-hidden="true" />
      <span
        className={styles.pill}
        aria-hidden="true"
        style={pill ? ({ '--pill-l': `${pill.l}px`, '--pill-r': `${pill.r}px` } as CSSProperties) : undefined}
      />
      {tabs.map((item, index) => {
        const count = item.count ? badges[item.count] : 0;
        const current = index === on;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={styles.tab}
            aria-label={named(TABS[item.href]!, count > 0 && countLabel(count))}
            data-tab
            data-on={current || undefined}
            aria-current={current ? 'page' : undefined}
          >
            <span className={styles.icon}>
              {item.icon}
              {badge(count)}
            </span>
            <span className={styles.clip}>
              <span className={styles.label}>
                <span data-label className={styles.text}>
                  {TABS[item.href]}
                </span>
              </span>
            </span>
          </Link>
        );
      })}
      <Popover
        label="More"
        buttonClassName={`${styles.tab} ${styles.more}`}
        buttonData={{ 'data-tab': '', 'data-on': moreOn ? '' : undefined }}
        panelClassName={styles.sheet}
        scrimClassName={styles.scrim}
        button={
          <>
            <span className={styles.icon}>{dots}</span>
            <span className={styles.clip}>
              <span className={styles.label}>
                <span data-label className={styles.text}>
                  More
                </span>
              </span>
            </span>
          </>
        }
      >
        {rest.map((item) => {
          const count = item.count ? badges[item.count] : 0;
          const needsYou = billingDot && item.href === '/app/billing';
          return (
            <Link
              key={item.href}
              href={item.href}
              className={styles.row}
              aria-label={named(item.label, count > 0 && countLabel(count), needsYou && 'needs you')}
              aria-current={at(pathname, item.href) ? 'page' : undefined}>
              {item.icon}
              {item.label}
              {count > 0 ? (
                <u className={styles.rowCount} aria-hidden="true">
                  {countLabel(count)}
                </u>
              ) : null}
              {needsYou ? <span className={styles.dot} aria-hidden="true" /> : null}
            </Link>
          );
        })}
      </Popover>
    </nav>
  );
}
