'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { SUSPENDED_ALERT_ID } from '../alert-ids.js';
import type { Alert } from '../alerts.js';
import styles from './alert-slot.module.css';

const AlertsContext = createContext<Alert[]>([]);

/** The frame's alerts, for every screen's header to read. */
export function AlertsProvider({ alerts, children }: { alerts: Alert[]; children: ReactNode }) {
  return <AlertsContext.Provider value={alerts}>{children}</AlertsContext.Provider>;
}

const ICONS = {
  lead: 'M4 20l1.4-4.2A8 8 0 1 1 8.6 19z',
  card: 'M3 6h18v13H3zM3 10h18',
  chat: 'M4 5h16v11H8l-4 4zM8 9h8M8 12h5',
  shop: 'M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 9l2-5h12l2 5',
  page: 'M6 3h9l4 4v14H6zM15 3v4h4',
} as const;

const KEY = (id: string) => `curios:alert-dismissed:${id}`;

function readDismissed(id: string): boolean {
  try {
    return window.localStorage.getItem(KEY(id)) === '1';
  } catch {
    return false;
  }
}

/**
 * The one alert a screen shows: a red one about this screen first (Orders'
 * "Your shop can't take orders right now", which says what the plan banner
 * does not), then one for every screen, then the one about this screen.
 */
export function pickAlert(alerts: Alert[], pathname: string): Alert | null {
  // A suspended page says so on every screen, whatever else is red there.
  const suspended = alerts.find((a) => a.id === SUSPENDED_ALERT_ID);
  if (suspended) return suspended;
  const here = alerts.filter((a) => a.where !== 'all' && pathname.startsWith(a.where));
  return here.find((a) => a.tone === 'stop') ?? alerts.find((a) => a.where === 'all') ?? here[0] ?? null;
}

/**
 * The banner itself. Blue ones can be dismissed, and stay dismissed in this
 * browser until their news changes (the id carries it); amber and red ones
 * stay until the thing they are about is done.
 */
export function AlertBanner({ alert, onDismiss }: { alert: Alert; onDismiss?: () => void }) {
  return (
    <div className={styles.ban} data-tone={alert.tone} role={alert.tone === 'info' ? 'status' : 'alert'}>
      <span className={styles.bi} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d={ICONS[alert.icon]} />
        </svg>
      </span>
      <span className={styles.bt}>
        <b>{alert.title}</b>
        <span>{alert.text}</span>
        {alert.meter ? (
          <span className={styles.bm} aria-hidden="true">
            {alert.meter.map((on, i) => (
              <i key={i} data-on={on || undefined} />
            ))}
          </span>
        ) : null}
      </span>
      <span className={styles.acts}>
        <a className={styles.btn} href={alert.action.href}>
          {alert.action.label}
        </a>
        {alert.tone === 'info' && onDismiss ? (
          <button type="button" className={styles.x} aria-label="Dismiss" onClick={onDismiss}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Under a screen's header: the alert for this screen, if any. Rendered by
 * PageHead, so it sits where the board draws it and comes after the title in
 * reading order; it reads the frame's alerts from context, and outside the
 * frame (onboarding) or with nothing to say it renders nothing and asks
 * nothing of the router.
 */
export function AlertSlot() {
  const alerts = useContext(AlertsContext);
  return alerts.length > 0 ? <PlacedAlert alerts={alerts} /> : null;
}

function PlacedAlert({ alerts }: { alerts: Alert[] }) {
  const pathname = usePathname() ?? '';
  const alert = pickAlert(alerts, pathname);
  const [dismissed, setDismissed] = useState(false);

  // Read after mount: the server cannot see this browser's storage.
  useEffect(() => {
    setDismissed(alert ? readDismissed(alert.id) : false);
  }, [alert?.id]);

  if (!alert || dismissed) return null;

  return (
    <div className={styles.slot}>
      <AlertBanner
        alert={alert}
        onDismiss={() => {
          try {
            window.localStorage.setItem(KEY(alert.id), '1');
          } catch {
            // Private windows refuse storage; it is dismissed for this visit only.
          }
          setDismissed(true);
        }}
      />
    </div>
  );
}
