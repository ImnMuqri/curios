'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { REPORT_REASONS, type ReportReasonKey } from '@curios/core/report';
import type { ReportGroup } from '@curios/db-read/admin';
import { ApiError, apiFetch } from '../../../lib/api.js';
import { ReasonDialog } from '../reason-dialog.js';
import { ActionDialog } from '../pages/action-dialog.js';
import styles from './reports.module.css';

/** The board's reason colours: red for the serious two, amber for impersonation, grey for the rest. */
const REASON_COLOUR: Record<ReportReasonKey, string> = {
  SCAM: '#d8452f',
  OFFENSIVE: '#d8452f',
  IMPERSONATION: '#f2a33c',
  WRONG_PRICES: '#9aa0ab',
  OTHER: '#9aa0ab',
};

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
const dayNumber = (d: Date) => Date.parse(`${ymd.format(d)}T00:00:00Z`) / 86_400_000;

/** "today", "yesterday", "3 days ago": whole days on the Malaysian calendar. */
export function whenOf(at: Date, now: Date): string {
  const days = Math.max(0, Math.round(dayNumber(now) - dayNumber(at)));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

type Ask = { kind: 'dismiss' | 'email' | 'suspend'; group: ReportGroup };

const hrefFor = (status: 'open' | 'closed') => (status === 'closed' ? '/reports?status=closed' : '/reports');

/** Dismiss and Email owner: the board's suspend pattern, one reason, one route. */
function copyFor(kind: 'dismiss' | 'email', handle: string) {
  return kind === 'dismiss'
    ? {
        title: `Dismiss reports on curios.my/${handle}?`,
        text: 'They move to Closed. Nothing changes on the page.',
        confirm: 'Dismiss',
        placeholder: 'E.g. Not a breach',
        route: 'dismiss',
        toast: 'Reports dismissed.',
      }
    : {
        title: `Email the owner of curios.my/${handle}?`,
        text: 'They get an email with your reason. The page stays live.',
        confirm: 'Send email',
        placeholder: 'E.g. Please correct the prices on your page',
        route: 'email-owner',
        toast: 'Email sent to the owner.',
      };
}

export function ReportsScreen({
  open,
  closed,
  status,
  now,
}: {
  open: ReportGroup[];
  closed: ReportGroup[];
  status: 'open' | 'closed';
  now: Date;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState<Ask | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const rows = status === 'open' ? open : closed;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function decide(group: ReportGroup, kind: 'dismiss' | 'email', reason: string) {
    const copy = copyFor(kind, group.handle);
    try {
      await apiFetch(`/admin/pages/${encodeURIComponent(group.pageId)}/reports/${copy.route}`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
    } catch (e) {
      // The API's words ("That page has no open reports.") read fine as they are.
      throw e instanceof ApiError ? e : new Error('Something failed. Try again.');
    }
    router.refresh();
    setAsking(null);
    setToast(copy.toast);
  }

  return (
    <>
      <div className={styles.head}>
        <h1>Reports</h1>
        <p>Pages visitors flagged</p>
      </div>

      <div className={styles.body}>
        <nav className={styles.tabs} aria-label="Filter reports">
          {(['open', 'closed'] as const).map((tab) => (
            <Link key={tab} href={hrefFor(tab)} className={styles.tab} aria-current={tab === status ? 'true' : undefined}>
              {tab === 'open' ? 'Open' : 'Closed'}
              <small>{(tab === 'open' ? open : closed).length}</small>
            </Link>
          ))}
        </nav>

        <ul className={styles.box} aria-label={status === 'open' ? 'Open reports' : 'Closed reports'}>
          {rows.map((g) => (
            <li key={g.pageId} className={styles.rep}>
              <div>
                <b>{g.displayName}</b> <span className={styles.mono}>curios.my/{g.handle}</span>
                <p className={styles.meta}>
                  <span className={styles.st}>
                    <i style={{ background: REASON_COLOUR[g.reason] }} />
                    {REPORT_REASONS[g.reason].en}
                  </span>{' '}
                  · {g.count} {g.count === 1 ? 'report' : 'reports'} · {whenOf(status === 'closed' && g.decidedAt ? g.decidedAt : g.latestAt, now)}
                </p>
                {g.quote && <q>{g.quote}</q>}
              </div>
              <div className={styles.acts}>
                {status === 'open' ? (
                  <>
                    <button type="button" className={styles.ghost} onClick={() => setAsking({ kind: 'dismiss', group: g })}>
                      Dismiss
                    </button>
                    <button type="button" className={styles.ghost} onClick={() => setAsking({ kind: 'email', group: g })}>
                      Email owner
                    </button>
                    <button type="button" className={styles.danger} onClick={() => setAsking({ kind: 'suspend', group: g })}>
                      Suspend page
                    </button>
                  </>
                ) : (
                  g.outcome && <span className={`${styles.st} ${styles.outcome}`}>{g.outcome}</span>
                )}
              </div>
            </li>
          ))}
          {rows.length === 0 && <li className={styles.empty}>Nothing here.</li>}
        </ul>
        <p className={styles.note}>
          Visitors report a page from the “Report this page” link in its footer. Nothing happens to a page until you act.
        </p>
      </div>

      {asking && asking.kind !== 'suspend' && (
        <ReasonDialog
          title={copyFor(asking.kind, asking.group.handle).title}
          text={copyFor(asking.kind, asking.group.handle).text}
          confirmLabel={copyFor(asking.kind, asking.group.handle).confirm}
          placeholder={copyFor(asking.kind, asking.group.handle).placeholder}
          ownerSees={asking.kind === 'email'}
          onConfirm={(reason) => decide(asking.group, asking.kind as 'dismiss' | 'email', reason)}
          onClose={() => setAsking(null)}
        />
      )}
      {asking?.kind === 'suspend' && (
        <ActionDialog
          kind="suspend"
          page={{ id: asking.group.pageId, handle: asking.group.handle, displayName: asking.group.displayName }}
          onClose={() => setAsking(null)}
          onDone={(text) => {
            setAsking(null);
            if (text) setToast(text);
          }}
        />
      )}

      {toast && (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      )}
    </>
  );
}
