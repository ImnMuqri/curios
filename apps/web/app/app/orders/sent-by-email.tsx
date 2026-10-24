'use client';

import { useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../../lib/api.js';
import styles from './orders.module.css';
import type { OrderRow } from './order-detail.js';

/** The owner's moves on a delivered order (`POST /orders/:id/<action>`); the body names the line and the new time. */
export type DigitalAction = 'resend' | 'new-links' | 'new-code' | 'move-time';
export type DigitalAct = (orderId: string, action: DigitalAction, body?: { lineId?: string; sessionId?: string }) => Promise<void>;

const KL = 'Asia/Kuala_Lumpur';
const ENVELOPE = 'M3 5h18v14H3zM3 7l9 6 9-6';

/** "Sat 7 Nov, 8:00pm", in Malaysia: the board's way of saying when a class runs. */
export function sessionTime(date: Date): string {
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: KL }).formatToParts(date);
  const part = (type: string) => day.find((p) => p.type === type)?.value ?? '';
  const clock = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hourCycle: 'h12', timeZone: KL }).format(date).replace(' ', '');
  return `${part('weekday')} ${part('day')} ${part('month')}, ${clock}`;
}

const untilDay = (date: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: KL }).format(date);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const downloaded = (n: number) => (n === 0 ? 'not downloaded yet' : n === 1 ? 'downloaded once' : `downloaded ${n} times`);

type DigitalOrderLine = OrderRow['lines'][number];

/** What happened to one line, in the board's words: one string per row. */
function lineState(line: DigitalOrderLine, sent: boolean, when: (date: Date) => string): ReactNode[] {
  const d = line.digital!;
  if (d.delivery === 'FILES') {
    if (!sent) return ['Download links go out when it’s paid'];
    const rows = d.files.map((f) => `${d.files.length > 1 ? `${f.name}: ` : ''}${downloaded(f.used)} · ${plural(f.left, 'download')} left`);
    const last = d.files.reduce<Date | null>((at, f) => (at === null || f.expiresAt > at ? f.expiresAt : at), null);
    return last ? [...rows, `Links until ${untilDay(last)}`] : rows;
  }
  if (d.delivery === 'LINK') {
    if (!sent) return ['Link goes out when it’s paid'];
    return [d.linkOpenedAt ? `Link sent · opened ${when(d.linkOpenedAt)}` : 'Link sent · not opened yet'];
  }
  if (d.delivery === 'CODES') {
    if (!sent) return ['A code is given when it’s paid'];
    const left = d.codesLeft === null ? '' : ` · ${plural(d.codesLeft, 'code')} left`;
    if (!d.codes.length) return [`No code given${left}`];
    return [
      <>
        Gave {d.codes.length > 1 ? 'codes' : 'code'} <b className={styles.sentCode}>{d.codes.join(', ')}</b>
        {left}
      </>,
    ];
  }
  if (d.delivery === 'SESSION' && d.session) {
    const time = sessionTime(d.session.startsAt);
    if (!sent) return [`Seat held for ${time}`];
    return [`${time} · ${plural(d.session.seats, 'seat')} booked${d.session.remindedAt ? ' · reminder sent' : ''}`];
  }
  return [];
}

/**
 * The digital half of an order: who it went to, what happened to each item,
 * and the four things the owner can do about it. Every action is the API's,
 * and its words show here if it refuses. Only "Resend the email" mails the
 * buyer, so the others say so and point at it.
 */
export function SentByEmail({
  order,
  first,
  when,
  act,
  say,
  onChanged,
}: {
  order: OrderRow;
  first: string;
  when: (date: Date) => string;
  act: DigitalAct;
  say: (text: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [moving, setMoving] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const inFlight = useRef(false);
  const sent = order.sentAt !== null;
  const lines = order.lines.filter((line) => line.digital !== null);

  async function run(action: DigitalAction, toast: string, body?: { lineId?: string; sessionId?: string }) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      await act(order.id, action, body);
      setMoving(null);
      say(toast);
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : 'That did not save. Try again.');
      if (failure instanceof ApiError && (failure.status === 404 || failure.status === 409)) onChanged();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="order-sent">
      <h3 className={styles.cardTitle} id="order-sent">
        Sent by email{' '}
        <span className={styles.badge} data-badge="" data-tone={sent ? 'hijau' : 'grey'}>
          {order.sentAt ? `Sent ${when(order.sentAt)}` : 'Not sent yet'}
        </span>
      </h3>
      <p className={styles.sentTo}>To {order.email}</p>
      {lines.map((line) => {
        const d = line.digital!;
        const rows = lineState(line, sent, when);
        const canMove = sent && d.delivery === 'SESSION' && d.session !== null;
        const action =
          !sent || order.status === 'CANCELLED'
            ? null
            : d.delivery === 'FILES'
              ? { text: 'New links', go: () => void run('new-links', `New download links made. Resend the email so ${first} gets them.`) }
              : d.delivery === 'CODES'
                ? { text: 'New code', go: () => void run('new-code', `Gave ${first} another code. They keep the first one. Resend the email to send both.`, { lineId: line.id }) }
                : canMove
                  ? { text: 'Move time', go: () => { setMoving(moving === line.id ? null : line.id); setPick(d.times[0]?.id ?? ''); setError(''); } }
                  : null;
        return (
          <div key={line.id}>
            <div className={styles.sentLine}>
              <span className={styles.sentText}>
                <b>
                  {line.quantity > 1 ? `${line.quantity}× ` : ''}
                  {line.itemName}
                </b>
                {rows.map((row, i) => (
                  <span key={i}>{row}</span>
                ))}
              </span>
              {action ? (
                <button type="button" className={styles.sentBtn} disabled={busy} aria-expanded={action.text === 'Move time' ? moving === line.id : undefined} onClick={action.go}>
                  {action.text}
                </button>
              ) : null}
            </div>
            {moving === line.id ? (
              d.times.length ? (
                <div className={styles.sentPick}>
                  <select aria-label={`Move ${first} to`} value={pick} onChange={(e) => setPick(e.target.value)}>
                    {d.times.map((t) => (
                      <option key={t.id} value={t.id}>
                        {sessionTime(t.startsAt)} · {plural(t.seatsLeft, 'seat')} left
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={styles.sentBtn}
                    disabled={busy || !pick}
                    onClick={() => {
                      const time = d.times.find((t) => t.id === pick);
                      if (time) void run('move-time', `Moved ${first} to ${sessionTime(time.startsAt)}. Resend the email so they know.`, { lineId: line.id, sessionId: pick });
                    }}
                  >
                    Move
                  </button>
                  <button type="button" className={styles.sentBtn} disabled={busy} onClick={() => setMoving(null)}>
                    Keep
                  </button>
                </div>
              ) : (
                <p className={styles.sentNone}>No other time with room for {first}. Add one in your store first.</p>
              )
            ) : null}
          </div>
        );
      })}
      {error ? (
        <p className={styles.sentError} role="alert">
          {error}
        </p>
      ) : null}
      {sent && order.status !== 'CANCELLED' ? (
        <button type="button" className={styles.sentResend} disabled={busy} onClick={() => void run('resend', `Sent again to ${order.email}.`)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={ENVELOPE} />
          </svg>
          Resend the email
        </button>
      ) : null}
    </section>
  );
}
