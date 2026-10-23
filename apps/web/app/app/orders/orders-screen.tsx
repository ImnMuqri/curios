'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { orderView } from '@curios/core/orders';
import { formatRinggit } from '@curios/core/store';
import type { OrderStats } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { CountUp } from '../_ui/count-up.js';
import ui from '../_ui/editor.module.css';
import inbox from '../_ui/inbox.module.css';
import { PageHead } from '../_ui/page-head.js';
import { useToast } from '../_ui/toast.js';
import panel from '../panel.module.css';
import { BADGES, dayLabel, Initial, itemCount, OrderDetail, plural, type OrderMove, type OrderRow } from './order-detail.js';
import styles from './orders.module.css';

type Filter = 'all' | 'check' | 'paid' | 'refund';

/** The board's `match`. */
function matches(order: OrderRow, filter: Filter): boolean {
  const view = orderView(order);
  if (filter === 'check') return view === 'toCheck';
  if (filter === 'paid') return view === 'paid' || view === 'paidOnline';
  // A second payment CHIP took on top of the first is money owed back too.
  if (filter === 'refund') return view === 'refundOwed' || order.chipPaidTwiceAt !== null;
  return true;
}

const FILTERS: { id: Filter; label: string; tone?: 'biru' | 'merah'; empty: string }[] = [
  { id: 'all', label: 'All', empty: '' },
  { id: 'check', label: 'To check', empty: 'No receipts waiting. New ones show here first.' },
  { id: 'paid', label: 'Paid', tone: 'biru', empty: 'Nothing paid and waiting to be made.' },
  { id: 'refund', label: 'Refunds', tone: 'merah', empty: 'Nobody is waiting on a refund.' },
];

const RECEIPT = 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h4';

/**
 * Every order the shop has taken, newest first: three figures, the orders
 * down the left (all, receipts to check, paid, refunds owed), and the chosen
 * one on the right with the one thing to do next.
 *
 * Presentational: `Orders` below supplies the real moves. After a move the
 * toast says it in the board's words and the server is read again, so the
 * list, the figures and the nav badge all follow.
 */
export function OrdersScreen({
  orders,
  stats,
  now,
  selected,
  keptMonths,
  shopUrl,
  publicUrl,
  pickupNote,
  move,
  onChanged,
}: {
  orders: OrderRow[];
  stats: OrderStats;
  now: Date;
  /** The order `?order=` names, opened first. */
  selected: string | null;
  keptMonths: number;
  /** The shop on this site, for "See your shop". */
  shopUrl: string;
  /** The shop's full address, for "Copy your link". */
  publicUrl: string;
  pickupNote: string | null;
  move: OrderMove;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [chosenId, setChosenId] = useState<string | null>(selected);
  const [copied, setCopied] = useState(false);
  const [grown, setGrown] = useState(false);
  const { say, toast } = useToast();

  // The spark grows in from nothing, as the board's does.
  useEffect(() => {
    const t = setTimeout(() => setGrown(true), 120);
    return () => clearTimeout(t);
  }, []);

  const shown = orders.filter((o) => matches(o, filter));
  const chosen = shown.find((o) => o.id === chosenId) ?? shown[0] ?? null;
  const counts: Record<Filter, number> = {
    all: 0,
    check: orders.filter((o) => matches(o, 'check')).length,
    paid: orders.filter((o) => matches(o, 'paid')).length,
    refund: orders.filter((o) => matches(o, 'refund')).length,
  };
  const top = Math.max(1, ...stats.week);
  const week = stats.paidThisWeekCents;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard here: the shop's address is one click away under See your shop.
    }
  }

  return (
    <>
      <PageHead title="Orders" note={`Newest first · kept for ${keptMonths} months`}>
        <a className={panel.secondaryLink} href={shopUrl} target="_blank" rel="noreferrer">
          See your shop
        </a>
      </PageHead>

      <ul className={inbox.stats} aria-label="Your orders">
        <li className={inbox.kpi}>
          <span className={`${inbox.kpiIcon} ${styles.kpiCheck}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="19" height="19">
              <path d={RECEIPT} />
            </svg>
          </span>
          <span>
            <b>
              <CountUp value={stats.toCheck} />
            </b>
            <span>Receipts to check</span>
          </span>
        </li>
        <li className={inbox.kpi}>
          <span className={inbox.kpiIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="19" height="19">
              <path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 9l2-5h12l2 5M9 13h6" />
            </svg>
          </span>
          <span>
            <b>
              <CountUp value={stats.toMake} />
            </b>
            <span>Paid, to make</span>
          </span>
        </li>
        <li className={inbox.kpi}>
          <span className={inbox.kpiIcon} data-tone="hijau" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="19" height="19">
              <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
            </svg>
          </span>
          <span>
            {/* Counted up in whole ringgit; a week with sen in it is said exactly instead. */}
            <b>{week % 100 === 0 ? <>RM<CountUp value={week / 100} /></> : formatRinggit(week)}</b>
            <span>Paid this week</span>
          </span>
          <span className={styles.spark} data-spark="" aria-hidden="true">
            {stats.week.map((sen, i) => (
              <i key={i} data-today={i === stats.week.length - 1 || undefined} style={{ height: Math.max(4, Math.round((sen / top) * 38 * (grown ? 1 : 0.05))) }} />
            ))}
          </span>
        </li>
      </ul>

      {orders.length === 0 ? (
        <div className={inbox.board} style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <div className={inbox.detail} style={{ display: 'grid', placeItems: 'center', minHeight: 520 }}>
            <div className={`${ui.empty} ${styles.empty}`}>
              <div className={`${ui.emptyArt} ${styles.emptyArt}`} aria-hidden="true">
                <span className={ui.ghostRows}>
                  <span data-tone="hijau">
                    <i />
                    <b />
                    <em />
                  </span>
                  <span data-tone="amber">
                    <i />
                    <b />
                    <em />
                  </span>
                  <span>
                    <i />
                    <b />
                    <em />
                  </span>
                </span>
                <span className={`${ui.emptyBadge} ${styles.emptyBadge}`}>
                  <svg viewBox="0 0 24 24" width="21" height="21">
                    <path d={RECEIPT} />
                  </svg>
                </span>
              </div>
              <h3>Your first order lands here</h3>
              <p>When someone checks out in your shop, the order shows up here with their receipt. You check it, mark it paid, and make it.</p>
              <span className={styles.emptyActions}>
                <button type="button" className={ui.primaryButton} onClick={() => void copyLink()}>
                  {copied ? 'Copied' : 'Copy your link'}
                </button>
                <a className={styles.outlineLink} href="/app/store">
                  Set up your shop
                </a>
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className={inbox.board}>
          <div className={inbox.list}>
            <div
              className={inbox.filters}
              role="tablist"
              aria-label="Show orders"
              style={{ '--at': FILTERS.findIndex((f) => f.id === filter), '--n': FILTERS.length } as CSSProperties}
            >
              {FILTERS.map((f) => (
                <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                  {counts[f.id] > 0 ? (
                    <i className={styles.filterCount} data-tone={f.tone}>
                      {counts[f.id]}
                    </i>
                  ) : null}
                </button>
              ))}
            </div>
            {shown.length === 0 ? (
              <p className={inbox.listEmpty}>
                <b>All clear</b>
                {FILTERS.find((f) => f.id === filter)?.empty}
              </p>
            ) : (
              <ul className={inbox.rows} aria-label="Orders">
                {shown.map((order, i) => {
                  const badge = BADGES[orderView(order)];
                  const n = itemCount(order);
                  return (
                    <li key={order.id}>
                      <button
                        type="button"
                        className={`${inbox.row} ${styles.row}`}
                        aria-current={chosen?.id === order.id}
                        style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                        onClick={() => setChosenId(order.id)}
                      >
                        <Initial order={order} />
                        <span className={styles.rowMid}>
                          <b>
                            {order.customerName}
                            {matches(order, 'check') ? <span className={styles.dot} aria-label="Receipt to check" title="Receipt to check" /> : null}
                          </b>
                          <span>
                            #{order.number} · {plural(n, 'item')} · {order.method === 'PICKUP' ? 'Pickup' : 'Delivery'} {dayLabel(order.day).split(' ')[0]}
                          </span>
                        </span>
                        <span className={styles.rowEnd}>
                          <b>{formatRinggit(order.totalCents)}</b>
                          <span className={styles.badge} data-tone={badge.tone}>
                            {badge.label}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className={inbox.detail}>
            {chosen ? <OrderDetail key={chosen.id} order={chosen} now={now} pickupNote={pickupNote} move={move} say={say} onChanged={onChanged} /> : null}
          </div>
        </div>
      )}
      {toast}
    </>
  );
}

/** Supplies the real moves; a Server Component may not hand closures across the RSC boundary. */
export function Orders(props: Omit<Parameters<typeof OrdersScreen>[0], 'move' | 'onChanged' | 'now'> & { now: string }) {
  const router = useRouter();
  const move: OrderMove = async (id, action) => {
    await apiFetch(`/orders/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
  };
  return <OrdersScreen {...props} now={new Date(props.now)} move={move} onChanged={() => router.refresh()} />;
}
