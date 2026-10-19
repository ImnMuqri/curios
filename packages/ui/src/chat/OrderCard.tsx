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

const TONES = ['wait', 'check', 'ok', 'stop', 'quiet'];
const isText = (value: unknown): value is string => typeof value === 'string';
const isSen = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** Whether a streamed `card` is one this component can draw; anything else is dropped, never half-drawn. */
export function isOrderCardData(value: unknown): value is OrderCardData {
  if (typeof value !== 'object' || value === null) return false;
  const card = value as Record<string, unknown>;
  const steps = card.steps as Record<string, unknown> | null | undefined;
  return (
    isSen(card.number) &&
    isText(card.code) &&
    isText(card.status) &&
    isText(card.pill) &&
    isText(card.tone) &&
    TONES.includes(card.tone) &&
    typeof steps === 'object' &&
    steps !== null &&
    ['placed', 'paid', 'ready', 'done'].every((key) => typeof steps[key] === 'boolean') &&
    isText(card.summary) &&
    isText(card.when) &&
    isSen(card.totalCents) &&
    isText(card.note)
  );
}

/** The well-formed `orderChips` of a streamed `done`, at most two. */
export function validOrderChips(value: unknown): { itemId: string; label: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (chip): chip is { itemId: string; label: string } =>
        typeof chip === 'object' &&
        chip !== null &&
        isText((chip as Record<string, unknown>).itemId) &&
        (chip as { itemId: string }).itemId !== '' &&
        isText((chip as Record<string, unknown>).label) &&
        (chip as { label: string }).label !== '',
    )
    .slice(0, 2)
    .map(({ itemId, label }) => ({ itemId, label }));
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
              <li key={key} className={styles.orderStep} data-state={state} aria-current={state === 'now' ? 'step' : undefined}>
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
