'use client';

import { openDays, orderTotals } from '@curios/core/orders';
import { formatRinggit } from '@curios/core/store';
import { PageTheme } from '../../_bento/BentoPage.js';
import { shopCopy } from '../../[handle]/shop/copy.js';
import { hasBank, PayBox } from '../../[handle]/order/[token]/pay-box.js';
import checkout from '../../[handle]/shop/checkout/checkout.module.css';
import order from '../../[handle]/order/[token]/order.module.css';
import type { EditorItem, ShopLook, StoreSettings } from './store-types.js';
import styles from './store.module.css';

/** An item's first price: its own, or its first option's, as the board's sample order takes it. */
function firstPrice(item: EditorItem): { cents: number; option: string | null } | null {
  if (item.priceCents !== null) return { cents: item.priceCents, option: null };
  const first = item.options[0];
  return first ? { cents: first.priceCents, option: first.label } : null;
}

/**
 * The preview's Pay screen (Store board, `pay`): the order page a customer
 * lands on after checkout, drawn with the order page's own pieces and its pay
 * box, for a sample order of one of each of the first two items. Delivery
 * when the shop delivers, else pickup, on the earliest day a customer could
 * pick. Nothing here uploads or copies anything that matters: it is a picture.
 */
export function PayPreview({
  look,
  settings,
  items,
  qrUrl,
  hasQr,
  today,
  nextNumber,
}: {
  look: ShopLook;
  settings: StoreSettings;
  /** What is in the shop now, in order. */
  items: EditorItem[];
  qrUrl: string | null;
  hasQr: boolean;
  /** Today in Malaysia, YYYY-MM-DD. */
  today: string;
  nextNumber: number;
}) {
  const copy = shopCopy(look.language);
  const lines = items.flatMap((item) => {
    const price = firstPrice(item);
    return price ? [{ name: item.name, option: price.option, unitCents: price.cents, quantity: 1 }] : [];
  }).slice(0, 2);
  const method = settings.deliveryMode === 'NONE' ? 'PICKUP' : 'DELIVERY';
  const totals = orderTotals(lines, { method, mode: settings.deliveryMode, feeCents: settings.deliveryFeeCents });
  // Midday in Malaysia, so the day is today's there whatever the browser's zone.
  const day = openDays({ now: new Date(`${today}T04:00:00Z`), minNoticeDays: settings.minNoticeDays, closedDays: settings.closedDays }, 1)[0] ?? today;
  const bank = { name: settings.bankName, accountName: settings.bankAccountName, accountNumber: settings.bankAccountNumber };
  const total = formatRinggit(totals.totalCents);
  const canPay = hasQr || hasBank(bank);

  return (
    <PageTheme theme={look} className={styles.payStage}>
      <div className={`${checkout.column} ${styles.payColumn}`}>
        <div className={checkout.top}>
          <span>{look.displayName}</span>
        </div>
        <div className={order.titleRow}>
          <h2 className={`${checkout.title} ${styles.payTitle}`}>{copy.orderTitle(nextNumber)}</h2>
          <span className={order.pill} data-tone="wait">
            <i aria-hidden="true" />
            {copy.statusWaiting}
          </span>
        </div>

        <section className={checkout.section}>
          <div className={checkout.head}>
            <h3 className={styles.payHead}>{copy.payTitle(total)}</h3>
            <span>{copy.payTo(look.displayName)}</span>
          </div>
          {canPay ? (
            <PayBox name={look.displayName} qrUrl={hasQr ? qrUrl : null} bank={bank} copy={copy} />
          ) : (
            <p className={order.askPay}>No way to pay yet. Add a QR or your bank account.</p>
          )}
          <div className={`${order.upload} ${styles.payUpload}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
            </svg>
            <span>
              <b>{copy.uploadReceipt}</b>
              <span>{copy.uploadHint}</span>
            </span>
          </div>
        </section>

        <section className={checkout.section}>
          <div className={checkout.head}>
            <h3 className={styles.payHead}>{copy.yourOrder}</h3>
            <span>
              {method === 'PICKUP' ? copy.pickupLabel : copy.deliveryLabel} · {copy.dayLong(day)}
            </span>
          </div>
          <ul className={order.lines}>
            {lines.map((line, i) => (
              <li key={i} className={order.line}>
                <span>
                  <b>
                    {line.quantity}× {line.name}
                  </b>
                  {line.option ? <span>{line.option}</span> : null}
                </span>
                <span>{formatRinggit(line.unitCents * line.quantity)}</span>
              </li>
            ))}
            {totals.deliveryCents > 0 ? (
              <li className={order.line}>
                <span>
                  <b>{copy.deliveryLabel}</b>
                </span>
                <span>{formatRinggit(totals.deliveryCents)}</span>
              </li>
            ) : null}
          </ul>
          <div className={order.total}>
            <span>{copy.total}</span>
            <span>{total}</span>
          </div>
        </section>
      </div>
    </PageTheme>
  );
}
