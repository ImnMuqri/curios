'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminPageDetail } from '@curios/db-read/admin';
import { ActionDialog, type ActionKind } from './action-dialog.js';
import { day, STATUS_COLOUR } from './format.js';
import styles from './pages.module.css';

const meterColour = (used: number, cap: number) =>
  used >= cap ? '#d8452f' : used >= cap * 0.8 ? '#f2a33c' : '#2340c8';

export function PagePanel({
  page,
  appUrl,
  listHref,
  onToast,
}: {
  page: AdminPageDetail;
  appUrl: string;
  listHref: string;
  onToast: (text: string) => void;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState<ActionKind | null>(null);
  const suspended = page.suspendedAt !== null;
  const used = page.conversationsThisMonth;
  const width = page.cap > 0 ? Math.min(100, (used / page.cap) * 100) : 0;
  const signIn =
    page.signInMethods.length === 0
      ? '-'
      : page.signInMethods.map((m) => (m === 'google' ? 'Google' : 'Email and password')).join(' and ');

  return (
    <aside className={`${styles.box} ${styles.panel}`} aria-label={`${page.displayName}, details`}>
      <h3>{page.displayName}</h3>
      <span className={styles.mono}>curios.my/{page.handle}</span>

      <dl className={styles.kv}>
        <dt>Owner</dt>
        <dd>{page.ownerEmail}</dd>
        <dt>Signs in with</dt>
        <dd>{signIn}</dd>
        <dt>Kind</dt>
        <dd>{page.mode === 'BUSINESS' ? 'Business' : 'Personal'}</dd>
        <dt>Plan</dt>
        <dd>{page.plan}</dd>
        <dt>Paid until</dt>
        <dd>{page.paidUntil ? day(page.paidUntil) : '-'}</dd>
        <dt>Created</dt>
        <dd>{day(page.createdAt)}</dd>
        <dt>Status</dt>
        <dd>
          <span className={styles.st}>
            <i className={styles.dot} style={{ background: STATUS_COLOUR[page.status] }} />
            {page.status}
          </span>
        </dd>
        {suspended && page.suspendedAt && (
          <>
            <dt>Suspended</dt>
            <dd className={styles.wrap}>
              {day(page.suspendedAt)}
              {page.suspendReason ? `: ${page.suspendReason}` : ''}
            </dd>
          </>
        )}
        {page.grantedMonths > 0 && (
          <>
            <dt>Months given</dt>
            <dd>{page.grantedMonths}</dd>
          </>
        )}
      </dl>

      <div className={styles.meter}>
        <p>
          Conversations this month
          <b>
            {used} of {page.cap}
          </b>
        </p>
        <span className={styles.bar}>
          <i style={{ width: `${width}%`, background: meterColour(used, page.cap) }} />
        </span>
      </div>
      <div className={styles.meter}>
        <p>
          Facts live<b>{page.factCount}</b>
        </p>
      </div>

      <div className={styles.acts}>
        <p>Look</p>
        <a className={styles.btn} href={`${appUrl}/${page.handle}`} target="_blank" rel="noreferrer">
          Open page<small>curios.my/{page.handle}</small>
        </a>
        <button type="button" className={styles.btn} onClick={() => setAsking('owner')}>
          See it as the owner<small>Read-only, logged</small>
        </button>
        <p className={styles.gap}>Change</p>
        <button type="button" className={styles.btn} onClick={() => setAsking('comp')}>
          Give one month of Business<small>No charge</small>
        </button>
        <button type="button" className={styles.btn} onClick={() => setAsking('reset')}>
          Reset this month&apos;s conversations<small>Back to 0</small>
        </button>
        <button type="button" className={`${styles.btn} ${styles.bad}`} onClick={() => setAsking(suspended ? 'unsuspend' : 'suspend')}>
          {suspended ? 'Bring the page back' : 'Suspend page'}
          <small>{suspended ? 'Goes live again' : 'Page and chat stop'}</small>
        </button>
        <button type="button" className={`${styles.btn} ${styles.bad}`} onClick={() => setAsking('del')}>
          Delete account<small>Can&apos;t be undone</small>
        </button>
      </div>
      <p className={styles.note}>Every action here goes in the audit log with your name and a reason.</p>

      {asking && (
        <ActionDialog
          kind={asking}
          page={page}
          onClose={() => setAsking(null)}
          onDone={(toast) => {
            if (asking === 'del') router.replace(listHref);
            setAsking(null);
            if (toast) onToast(toast);
          }}
        />
      )}
    </aside>
  );
}
