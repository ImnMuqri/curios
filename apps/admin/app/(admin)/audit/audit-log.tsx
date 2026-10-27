import Link from 'next/link';
import type { AuditRow } from '@curios/db-read/admin';
import { ADMIN_ACTIONS } from '@curios/core/admin';
import { switchTitle } from '../controls/switches.js';
import styles from './audit.module.css';

export const AUDIT_PAGE_SIZE = 100;

const LABELS: Record<string, string> = {
  [ADMIN_ACTIONS.SIGNED_IN]: 'Signed in',
  [ADMIN_ACTIONS.SUSPENDED_PAGE]: 'Suspended the page',
  [ADMIN_ACTIONS.UNSUSPENDED_PAGE]: 'Brought the page back',
  [ADMIN_ACTIONS.GRANTED_MONTH]: 'Gave one month of Business',
  [ADMIN_ACTIONS.RESET_CONVERSATIONS]: "Reset this month's conversations",
  [ADMIN_ACTIONS.DELETED_ACCOUNT]: 'Deleted the account',
  [ADMIN_ACTIONS.VIEWED_AS_OWNER]: 'Saw the page as the owner',
  [ADMIN_ACTIONS.DISMISSED_REPORTS]: 'Dismissed reports',
  [ADMIN_ACTIONS.EMAILED_OWNER]: 'Emailed the owner about a report',
  [ADMIN_ACTIONS.CHANGED_LIMITS]: 'Changed limits and prices',
  [ADMIN_ACTIONS.SHOWED_BANNER]: 'Showed a banner to all owners',
  [ADMIN_ACTIONS.TOOK_BANNER_DOWN]: 'Took the banner down',
  [ADMIN_ACTIONS.REPLAYED_WEBHOOK]: 'Replayed a payment webhook',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur',
  day: 'numeric',
  month: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "20 Oct 22:31", on the Malaysian clock. */
export function when(d: Date): string {
  const p = Object.fromEntries(parts.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day} ${MONTHS[Number(p.month) - 1]} ${p.hour}:${p.minute}`;
}

/**
 * An action string as words; one we do not know yet is shown as it is. A switch's is built from
 * what it was done to ("Turned off chat answers"), because one action covers all five switches.
 */
export function actionLabel(action: string, targetId?: string): string {
  if (action === ADMIN_ACTIONS.TURNED_OFF || action === ADMIN_ACTIONS.TURNED_ON) {
    const verb = action === ADMIN_ACTIONS.TURNED_OFF ? 'Turned off' : 'Turned on';
    const title = targetId ? switchTitle(targetId) : undefined;
    return title ? `${verb} ${title}` : `${verb} a switch`;
  }
  return LABELS[action] ?? action;
}

// These are about nobody's page. A sign-in's target is the admin's own email, which stays off the
// screen; a setting's target is the switch or the banner, and the change reaches everyone.
const EVERYONE = new Set<string>([
  ADMIN_ACTIONS.SIGNED_IN,
  ADMIN_ACTIONS.TURNED_OFF,
  ADMIN_ACTIONS.TURNED_ON,
  ADMIN_ACTIONS.CHANGED_LIMITS,
  ADMIN_ACTIONS.SHOWED_BANNER,
  ADMIN_ACTIONS.TOOK_BANNER_DOWN,
]);
const everyone = (action: string) => EVERYONE.has(action);

export function AuditLog({ rows, paged }: { rows: AuditRow[]; paged: boolean }) {
  const last = rows[rows.length - 1];
  return (
    <>
      <div className={styles.head}>
        <h1>Audit log</h1>
        <p>Every admin action, newest first</p>
      </div>
      <div className={styles.body}>
        <div className={`${styles.box} ${styles.tw}`}>
          <div className={styles.table} role="table" aria-label="Audit log">
            <div className={styles.row} role="row">
              {['When', 'Who', 'What', 'Page', 'Reason'].map((h) => (
                <div key={h} className={styles.h} role="columnheader">
                  {h}
                </div>
              ))}
            </div>
            {rows.map((r) => (
              <div key={r.id} className={styles.row} role="row">
                <div className={styles.c} role="cell">
                  <time dateTime={r.createdAt.toISOString()}>{when(r.createdAt)}</time>
                </div>
                <div className={styles.c} role="cell">
                  {r.adminName}
                </div>
                <div className={styles.c} role="cell">
                  <b>{actionLabel(r.action, r.targetId)}</b>
                </div>
                <div className={styles.c} role="cell">
                  <span className={styles.mono}>{everyone(r.action) ? 'everyone' : `curios.my/${r.targetLabel}`}</span>
                </div>
                <div className={`${styles.c} ${styles.why}`} role="cell">
                  {r.reason}
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <p className={styles.empty}>{paged ? 'Nothing older.' : 'Nothing has been done yet.'}</p>
            )}
          </div>
        </div>
        <p className={styles.more}>
          {paged && <Link href="/audit">Newest</Link>}
          {last && rows.length >= AUDIT_PAGE_SIZE && (
            <Link href={`/audit?before=${encodeURIComponent(last.createdAt.toISOString())}`}>Older</Link>
          )}
        </p>
      </div>
    </>
  );
}
