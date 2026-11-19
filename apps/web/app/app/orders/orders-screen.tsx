'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { malaysiaToday } from '@curios/core/orders';
import { windowLabel } from '@curios/core/pickup';
import { formatRinggit } from '@curios/core/store';
import type { OrderStats } from '@curios/db-read';
import { apiFetch } from '../../../lib/api.js';
import { EmptyPeek } from '../_ui/empty-peek.js';
import { InboxBack } from '../_ui/inbox-back.js';
import inbox from '../_ui/inbox.module.css';
import { PageHead } from '../_ui/page-head.js';
import { StatStrip, type StatCard } from '../_ui/stat-strip.js';
import { useToast } from '../_ui/toast.js';
import { dayLabel, Initial, itemCount, OrderDetail, orderTag, owesSecond, ownerView, plural, Tag, type OrderMove, type OrderRow } from './order-detail.js';
import type { DigitalAct } from './sent-by-email.js';
import styles from './orders.module.css';

type Filter = 'all' | 'check' | 'paid' | 'refund';

const DAY_MS = 86_400_000;
/** Under this width a picked order takes the screen as its own view (the frame's phone, inbox.module.css). */
const OWN_VIEW = '(max-width: 1100px)';

/** The board's `match`. */
function matches(order: OrderRow, filter: Filter): boolean {
  const view = ownerView(order);
  if (filter === 'check') return view === 'toCheck';
  if (filter === 'paid') return view === 'paid' || view === 'paidOnline';
  // A second payment CHIP took on top of the first is money owed back too, until it is marked refunded.
  if (filter === 'refund') return view === 'refundOwed' || owesSecond(order);
  return true;
}

const FILTERS: { id: Filter; label: string; empty: string }[] = [
  { id: 'all', label: 'All', empty: '' },
  { id: 'check', label: 'To check', empty: 'No receipts waiting. New ones show here first.' },
  { id: 'paid', label: 'Paid', empty: 'Nothing paid and waiting to be made.' },
  { id: 'refund', label: 'Refunds', empty: 'Nobody is waiting on a refund.' },
];

/**
 * Whether an order answers the search box: the customer's name, the order's
 * number (with or without its #), the phone's digits, or an item's name. It
 * searches the orders on this screen; older finished ones are a page further.
 */
export function orderMatches(order: OrderRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  const number = q.replace(/^#/, '');
  return (
    order.customerName.toLowerCase().includes(q) ||
    String(order.number) === number ||
    (digits.length >= 3 && order.phone.replace(/\D/g, '').includes(digits)) ||
    order.lines.some((line) => line.itemName.toLowerCase().includes(q))
  );
}

/** Back to the top of the screen: whichever of its ancestors scrolls (the frame's sheet, or the page itself). */
function scrollToTop(el: HTMLElement | null) {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    if (node.scrollTop > 0) node.scrollTop = 0;
  }
  if (typeof window !== 'undefined' && window.scrollY > 0) window.scrollTo(0, 0);
}

/** "#14 · 3 items · Pickup Sat", with the pickup time when the order kept one. */
function rowLine(order: OrderRow): string {
  const what = `#${order.number} · ${plural(itemCount(order), 'item')}`;
  if (order.method === null) return `${what} · Digital`;
  const day = dayLabel(order.day).split(' ')[0];
  const time = order.method === 'PICKUP' && order.pickupFrom !== null && order.pickupTo !== null ? `, ${windowLabel(order.pickupFrom, order.pickupTo)}` : '';
  return `${what} · ${order.method === 'PICKUP' ? 'Pickup' : 'Delivery'} ${day}${time}`;
}

/**
 * Every order the shop has taken, on the calm board (Dash.html `orders`): the header ("Inbox",
 * Orders, one line, See your shop), three stat cards (the receipts to check, what is paid and to
 * make, this week's takings with its spark), the filter chips and search, then the orders down the
 * left and the chosen one on the right. Orders placed before the last 7 days sit under "Older
 * orders"; the next hundred finished ones are a page further (`?before=`).
 *
 * On a phone a picked order takes the screen as its own view (`data-open` on the split), with
 * "‹ All orders" back: focus goes to the order's heading on the way in and back to its row on the
 * way out, the screen scrolled to the top each time.
 *
 * Presentational: `Orders` below supplies the real moves. After a move the toast says it in the
 * board's words and the server is read again, so the list, the cards and the nav badge all follow.
 */
export function OrdersScreen({
  orders,
  paging = { older: null, paged: false },
  stats,
  now,
  selected,
  keptMonths,
  shopUrl,
  publicUrl,
  move,
  act,
  onChanged,
}: {
  orders: OrderRow[];
  /** `older`: the last finished order shown, when there are more below it. `paged`: this is not the first page. */
  paging?: { older: string | null; paged: boolean };
  stats: OrderStats;
  now: Date;
  /** The order `?order=` names, opened first. */
  selected: string | null;
  keptMonths: number;
  /** The shop on this site, for "See your shop". */
  shopUrl: string;
  /** The shop's full address, for "Copy your link". */
  publicUrl: string;
  move: OrderMove;
  act: DigitalAct;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [chosenId, setChosenId] = useState<string | null>(selected);
  // The phone's own view: an order picked from the list (or named by the link) fills the screen.
  const [open, setOpen] = useState(selected !== null && orders.some((o) => o.id === selected));
  const [copied, setCopied] = useState(false);
  const { say, fail, toast } = useToast();
  const screenRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  // After the own view opens or closes: 'detail', or the id of the row to land back on.
  const focusAfter = useRef<string | null>(null);

  const shown = orders.filter((o) => matches(o, filter) && orderMatches(o, query));
  // On a phone the open order keeps the screen, by id, until the owner goes back: after a move it may
  // leave the filter (a receipt marked paid under To check), and the own view must never go blank or
  // turn into another customer's order under the same thumb.
  // The open order is gone from the list altogether (another tab, a later page): back to the list, saying so.
  const gone = open && chosenId !== null && !orders.some((o) => o.id === chosenId);
  const pinned = open ? (orders.find((o) => o.id === chosenId) ?? null) : null;
  const chosen = gone ? null : pinned ?? shown.find((o) => o.id === chosenId) ?? shown[0] ?? null;
  // One count everywhere: the chips say what the cards say (and the sidebar badge, countNavBadges).
  const counts: Record<Filter, number | null> = {
    all: null,
    check: stats.toCheck,
    paid: stats.toMake,
    refund: orders.filter((o) => matches(o, 'refund')).length,
  };

  useEffect(() => {
    if (!gone) return;
    focusAfter.current = null;
    setOpen(false);
    say('That order is no longer in this list.');
    scrollToTop(screenRef.current);
  }, [gone, say]);

  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    scrollToTop(screenRef.current);
    const el =
      target === 'detail'
        ? detailRef.current?.querySelector<HTMLElement>('[data-detail-heading]')
        : screenRef.current?.querySelector<HTMLElement>(`[data-order-row="${CSS.escape(target)}"]`);
    el?.focus({ preventScroll: true });
  }, [open]);

  // A filter or search is changed from the list, so no order holds the own view any more (a ?order= link's included).
  function choose(next: Filter) {
    setFilter(next);
    setOpen(false);
  }

  function pick(id: string) {
    setChosenId(id);
    // Only where the own view shows: on a wide screen the detail is beside the list already.
    if (typeof window !== 'undefined' && window.matchMedia?.(OWN_VIEW).matches) {
      focusAfter.current = 'detail';
      setOpen(true);
    }
  }

  function back() {
    focusAfter.current = chosen?.id ?? null;
    setOpen(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard here: the shop's address is one click away under See your shop.
    }
  }

  const cards: StatCard[] = [
    {
      id: 'check',
      label: 'Receipt to check',
      value: stats.toCheck,
      urgent: true,
      filter: 'check',
      go: (
        <>
          Check it <span aria-hidden="true">→</span>
        </>
      ),
    },
    {
      id: 'paid',
      label: 'Paid, to make',
      value: stats.toMake,
      filter: 'paid',
      go: (
        <>
          See them <span aria-hidden="true">→</span>
        </>
      ),
    },
    {
      id: 'week',
      label: 'This week',
      value: formatRinggit(stats.paidThisWeekCents),
      line: stats.paidTodayCents > 0 ? `+${formatRinggit(stats.paidTodayCents)} today` : undefined,
      // Exactly the week: seven days, today last.
      spark: Array.from({ length: 7 }, (_, i) => stats.paidDaysCents[stats.paidDaysCents.length - 7 + i] ?? 0),
    },
  ];

  // Placed before the last 7 days: under "Older orders", on the All list (owner, 19 Nov 2026). The
  // same 7 Malaysian days as the This week card: from 00:00 in Malaysia, six days before today.
  const weekAgo = Date.parse(`${malaysiaToday(now)}T00:00:00+08:00`) - 6 * DAY_MS;
  const newer = filter === 'all' ? shown.filter((o) => o.createdAt.getTime() >= weekAgo) : shown;
  const older = filter === 'all' ? shown.filter((o) => o.createdAt.getTime() < weekAgo) : [];

  const row = (order: OrderRow, i: number) => (
    <li key={order.id} className={styles.item}>
      <button
        type="button"
        className={`${inbox.li} ${styles.rowBtn}`}
        aria-current={chosen?.id === order.id}
        data-order-row={order.id}
        style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
        onClick={() => pick(order.id)}
      >
        <Initial order={order} />
        <span className={inbox.liText}>
          <b>{order.customerName}</b>
          <small>{rowLine(order)}</small>
        </span>
        <span className={inbox.liSide}>
          <b>{formatRinggit(order.totalCents)}</b>
          <Tag tag={orderTag(order)} />
        </span>
      </button>
    </li>
  );

  return (
    <>
      <div ref={screenRef} className={inbox.screen}>
        <PageHead kicker="Inbox" title="Orders" summary="Check receipts first. Everything else waits for you below.">
          <a className={styles.headLink} href={shopUrl} target="_blank" rel="noreferrer">
            See your shop
          </a>
        </PageHead>

        <div className={inbox.body}>
          {orders.length === 0 ? (
            <EmptyPeek
              title="Your first order lands here"
              line="When someone checks out in your shop, the order shows up here with their receipt. You check it, mark it paid, and make it."
            >
              <button type="button" className={styles.darkPill} onClick={() => void copyLink()}>
                {copied ? 'Copied' : 'Copy your link'}
              </button>
              <a className={styles.headLink} href="/app/store">
                Set up your shop
              </a>
            </EmptyPeek>
          ) : (
            <>
              <StatStrip
                label="Orders at a glance"
                cards={cards}
                active={filter === 'check' || filter === 'paid' ? filter : null}
                onFilter={(next) => choose((next as Filter | null) ?? 'all')}
              />

              <div className={inbox.fbar}>
                <div className={inbox.chips} role="group" aria-label="Show orders">
                  {FILTERS.map((f) => (
                    <button key={f.id} type="button" className={inbox.chip} aria-pressed={filter === f.id} onClick={() => choose(f.id)}>
                      {f.label}
                      {counts[f.id] ? <u>{counts[f.id]}</u> : null}
                    </button>
                  ))}
                </div>
                <label className={inbox.search}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-3.5-3.5" />
                  </svg>
                  <input type="search" value={query} placeholder="Search name or order" aria-label="Search name or order" onChange={(event) => {
                      setQuery(event.target.value);
                      setOpen(false);
                    }} />
                </label>
              </div>

              <div className={inbox.split} data-open={open || undefined}>
                <div className={inbox.list}>
                  {shown.length === 0 ? (
                    query.trim() ? (
                      <p className={styles.empty}>
                        <b>No match</b>
                        <small>Try a name or an order number, like 14.</small>
                      </p>
                    ) : paging.paged && filter !== 'all' ? (
                      // A later page holds finished orders only: what needs the owner is on the first one.
                      <p className={styles.empty}>
                        <b>Not on this page</b>
                        <small>
                          These are older, finished orders. What still needs you is on the <Link href="/app/orders">newest page</Link>.
                        </small>
                      </p>
                    ) : (
                      <p className={styles.empty}>
                        <b>All clear</b>
                        <small>{FILTERS.find((f) => f.id === filter)?.empty}</small>
                      </p>
                    )
                  ) : (
                    <>
                      {newer.length ? (
                        <ul className={styles.rows} aria-label="Orders">
                          {newer.map((order, i) => row(order, i))}
                        </ul>
                      ) : null}
                      {older.length ? (
                        <>
                          <p className={styles.old} id="orders-older">
                            Older orders
                          </p>
                          <ul className={styles.rows} aria-labelledby="orders-older">
                            {older.map((order, i) => row(order, newer.length + i))}
                          </ul>
                        </>
                      ) : null}
                    </>
                  )}
                  <div className={styles.foot}>
                    {paging.older || paging.paged ? (
                      <nav className={inbox.pager} aria-label="More orders">
                        {paging.paged ? <Link href="/app/orders">Newest</Link> : null}
                        {paging.older ? <Link href={`/app/orders?before=${encodeURIComponent(paging.older)}`}>Older orders</Link> : null}
                      </nav>
                    ) : null}
                    <p className={styles.kept}>Newest first · kept for {keptMonths} months</p>
                  </div>
                </div>
                {chosen ? (
                  <div ref={detailRef} className={inbox.det}>
                    <InboxBack noun="orders" onBack={back} />
                    <OrderDetail key={chosen.id} order={chosen} now={now} move={move} act={act} say={say} warn={fail} onChanged={onChanged} />
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
      {toast}
    </>
  );
}

/** Supplies the real moves; a Server Component may not hand closures across the RSC boundary. */
export function Orders(props: Omit<Parameters<typeof OrdersScreen>[0], 'move' | 'act' | 'onChanged' | 'now'> & { now: string }) {
  const router = useRouter();
  const move: OrderMove = async (id, action) => {
    await apiFetch(`/orders/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
  };
  const act: DigitalAct = async (id, action, body) => {
    await apiFetch(`/orders/${encodeURIComponent(id)}/${action}`, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
  };
  return <OrdersScreen {...props} now={new Date(props.now)} move={move} act={act} onChanged={() => router.refresh()} />;
}
