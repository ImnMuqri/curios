import styles from './ChatMode.module.css';

/**
 * The `order` event's card: the Public board's `ocard`. Mirrors the API's
 * `OrderCard` (apps/api/src/modules/chat/order-lookup.ts).
 */
export interface OrderCardData {
  number: number;
  code: string;
  status: string;
  pill: string;
  tone: 'wait' | 'check' | 'ok' | 'stop' | 'quiet';
  steps: { placed: boolean; paid: boolean; ready: boolean; done: boolean };
  summary: string;
  when: string;
  totalCents: number;
  note: string;
}

/** As `formatRinggit` (@curios/core/store) writes money; this package does not depend on core. */
function ringgit(cents: number): string {
  const whole = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sen = cents % 100;
  return sen === 0 ? `RM${whole}` : `RM${whole}.${sen.toString().padStart(2, '0')}`;
}

const STEPS = [
  ['placed', 'Placed'],
  ['paid', 'Paid'],
  ['ready', 'Ready'],
  ['done', 'Done'],
] as const;

export function OrderCard({ card }: { card: OrderCardData }) {
  const title = `Order #${card.number} · ${card.code}`;
  // A cancelled order has no progress to show, as on the order page.
  const stopped = card.tone === 'stop' || card.tone === 'quiet';
  const nowAt = STEPS.findIndex(([key]) => !card.steps[key]);

  return (
    <div role="group" aria-label={title} className={styles.orderCard}>
      <div className={styles.orderHead}>
        <span>
          <small>{title}</small>
          <b>{card.status}</b>
        </span>
        <span className={styles.orderPill} data-tone={card.tone}>
          {card.pill}
        </span>
      </div>
      {stopped ? null : (
        <ol className={styles.orderSteps} aria-label="Order progress">
          {STEPS.map(([key, label], i) => {
            const done = card.steps[key];
            const state = done ? 'done' : i === nowAt ? 'now' : undefined;
            return (
              <li key={key} className={styles.orderStep} data-state={state}>
                <i aria-hidden="true">
                  {done ? (
                    <svg viewBox="0 0 24 24">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  ) : null}
                </i>
                <span>
                  {label}
                  {done ? <span className={styles.srOnly}>, done</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className={styles.orderSummary}>{card.summary}</p>
      <div className={styles.orderFoot}>
        <span>{card.when}</span>
        <b>{ringgit(card.totalCents)}</b>
      </div>
      <p className={styles.orderNote}>{card.note}</p>
    </div>
  );
}
