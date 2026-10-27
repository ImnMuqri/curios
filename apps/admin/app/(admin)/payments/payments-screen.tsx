'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ringgit } from '@curios/core/money';
import type { Payments, Period, PaymentRowStatus, WebhookRow } from '@curios/db-read/admin';
import { apiFetch } from '../../../lib/api.js';
import { PERIODS } from '../period.js';
import { ReasonDialog } from '../reason-dialog.js';
import { said } from '../said.js';
import ui from '../ui.module.css';
import styles from './payments.module.css';

const int = (n: number) => n.toLocaleString('en-US');

/** The board's status colours. */
const STATUS_COLOUR: Record<PaymentRowStatus, string> = {
  Paid: '#1d9a6c',
  'Not confirmed': '#f2a33c',
  Abandoned: '#9aa0ab',
  Failed: '#d8452f',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayNumber = (d: Date) => Date.parse(`${ymd.format(d)}T00:00:00Z`) / 86_400_000;

/** "Today 10:48", "Yesterday", "22 Oct": the board's dates, on the Malaysian calendar. */
export function whenOf(at: Date, now: Date): string {
  const days = Math.round(dayNumber(now) - dayNumber(at));
  if (days <= 0) return `Today ${hm.format(at)}`;
  if (days === 1) return 'Yesterday';
  const [, m, n] = ymd.format(at).split('-').map(Number) as [number, number, number];
  return `${n} ${MONTHS[m - 1]}`;
}

const HEADS: [string, boolean][] = [
  ['Date', false],
  ['Page', false],
  ['Plan', false],
  ['Paid by', false],
  ['Amount', true],
  ['Status', false],
  ['CHIP ref', false],
];

function hookColour(h: WebhookRow): string {
  return h.outcome === 'failed' ? '#d8452f' : h.outcome === 'ok' ? '#1d9a6c' : '#9aa0ab';
}

function hookSub(h: WebhookRow, now: Date): string {
  if (h.outcome === 'failed') {
    const answer = h.statusCode === null ? 'Our server did not answer.' : `Our server answered ${h.statusCode}.`;
    return `${answer} ${h.displayName ? `${h.displayName}’s` : 'A'} payment may not show as paid.`;
  }
  const when = whenOf(h.lastAttemptAt, now);
  return h.outcome === 'ok' && h.statusCode !== null ? `${when} · ${h.statusCode} OK` : when;
}

export function PaymentsScreen({ payments: p, period, now }: { payments: Payments; period: Period; now: Date }) {
  const router = useRouter();
  const [replaying, setReplaying] = useState<WebhookRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const phrase = PERIODS.find((x) => x.key === period)?.phrase ?? '';

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function replay(hook: WebhookRow, reason: string) {
    let result: { status: string } | null;
    try {
      result = await apiFetch<{ status: string } | null>(`/admin/webhooks/${encodeURIComponent(hook.id)}/replay`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
    } catch (e) {
      // A replay that fails again still counts as an attempt: show the new count behind the dialog.
      router.refresh();
      throw said(e);
    }
    router.refresh();
    setReplaying(null);
    setToast(result?.status ? `Replayed. ${result.status}` : 'Replayed.');
  }

  const figures = [
    { value: ringgit(p.receivedCents), label: `Received, ${phrase}`, note: '', red: false },
    {
      value: int(p.paying.total),
      label: 'Paying for Business',
      note: `${int(p.paying.monthly)} monthly, ${int(p.paying.annual)} yearly`,
      red: false,
    },
    { value: int(p.endingThisWeek), label: 'Ending this week', note: 'Reminders go 3 days before', red: false },
    { value: int(p.failedWebhooks24h), label: 'Webhook failed', note: 'Needs a replay', red: p.failedWebhooks24h > 0 },
  ];

  return (
    <>
      <div className={ui.head}>
        <h1>Payments</h1>
        <p>Business plans, paid through CHIP</p>
        <nav className={ui.per} aria-label="Period">
          {PERIODS.map((x) => (
            <Link
              key={x.key}
              href={x.key === '7d' ? '/payments' : `/payments?period=${x.key}`}
              aria-current={x.key === period ? 'true' : undefined}
            >
              {x.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className={ui.body}>
        <div className={ui.stats}>
          {figures.map((f) => (
            <div key={f.label} className={ui.stat}>
              <b>{f.value}</b>
              <span>{f.label}</span>
              <small className={f.red ? undefined : ui.soft} style={f.red ? { color: '#b4321f' } : undefined}>
                {f.note}
              </small>
            </div>
          ))}
        </div>

        <div className={ui.grid}>
          <div className={ui.sec}>
            <h2 className={ui.h2}>
              Business payments<span>Through Curios’s own CHIP account</span>
            </h2>
            <div className={`${ui.box} ${ui.tw}`}>
              <div
                className={ui.t}
                role="table"
                aria-label="Business payments"
                style={{ '--cols': '92px minmax(130px,1.4fr) 70px minmax(120px,1.3fr) 70px minmax(116px,1.1fr) 92px', '--minw': '800px' } as CSSProperties}
              >
                <div className={ui.r} role="row">
                  {HEADS.map(([h, right]) => (
                    <div key={h} className={right ? `${ui.h} ${ui.right}` : ui.h} role="columnheader">
                      {h}
                    </div>
                  ))}
                </div>
                {p.rows.map((r) => (
                  <div key={r.id} className={ui.r} role="row">
                    <div className={ui.c} role="cell">
                      {whenOf(r.createdAt, now)}
                    </div>
                    <div className={ui.c} role="cell">
                      <span className={ui.pg}>
                        <b>{r.name}</b>
                      </span>
                    </div>
                    <div className={ui.c} role="cell">
                      {r.plan === 'ANNUAL' ? 'Yearly' : 'Monthly'}
                    </div>
                    <div className={ui.c} role="cell">
                      {r.paidVia ?? '—'}
                    </div>
                    <div className={`${ui.c} ${ui.right}`} role="cell">
                      <b>{ringgit(r.amountCents)}</b>
                    </div>
                    <div className={ui.c} role="cell">
                      <span className={ui.st}>
                        <i style={{ background: STATUS_COLOUR[r.status] }} />
                        {r.status}
                      </span>
                    </div>
                    <div className={ui.c} role="cell">
                      <span className={ui.mono}>{r.providerRef ?? '—'}</span>
                    </div>
                  </div>
                ))}
                {p.rows.length === 0 && (
                  <div className={ui.r} role="row">
                    <div className={ui.empty} role="cell">
                      No payments yet.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={ui.sec}>
            <h2 className={ui.h2}>
              Payment webhooks<span>Last 24 hours</span>
            </h2>
            <div className={ui.box}>
              {p.webhooks.map((h) => (
                <div key={h.id} className={styles.need}>
                  <i style={{ background: hookColour(h) }} />
                  <span>
                    <b>
                      {h.eventType} · {h.purchaseId}
                      {h.outcome === 'failed' ? ` · failed ${h.attempts} ${h.attempts === 1 ? 'time' : 'times'}` : ''}
                    </b>
                    <small>{hookSub(h, now)}</small>
                  </span>
                  {h.outcome === 'failed' && (
                    <button type="button" onClick={() => setReplaying(h)}>
                      Replay
                    </button>
                  )}
                </div>
              ))}
              {p.webhooks.length === 0 && <p className={ui.nothing}>No webhooks in the last 24 hours.</p>}
            </div>
            <p className={ui.note}>
              Shop orders are paid into each owner’s own CHIP account. Curios only sees that an order was paid, never the money.
            </p>
            <div className={`${ui.box} ${styles.shop}`}>
              <p className={styles.shopHead}>Shop orders paid online, this month</p>
              <p className={styles.shopFig}>
                {int(p.shop.orders)} {p.shop.orders === 1 ? 'order' : 'orders'} · {ringgit(p.shop.totalCents)}
              </p>
              <p className={styles.shopHead}>Across {int(p.shop.shops)} {p.shop.shops === 1 ? 'shop' : 'shops'}. Owners’ money, shown for scale only.</p>
            </div>
          </div>
        </div>
      </div>

      {replaying && (
        <ReasonDialog
          title="Replay this webhook?"
          text={`CHIP’s ${replaying.eventType} message for ${replaying.purchaseId} runs through our server again. It goes in the audit log.`}
          confirmLabel="Replay"
          placeholder="E.g. Failed 3 times, our server was down"
          onConfirm={(reason) => replay(replaying, reason)}
          onClose={() => setReplaying(null)}
        />
      )}

      {toast && (
        <div className={ui.toast} role="status">
          {toast}
        </div>
      )}
    </>
  );
}
