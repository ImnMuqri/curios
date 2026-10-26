'use client';

import { openDays, orderTotals } from '@curios/core/orders';
import { PageTheme } from '../../_bento/BentoPage.js';
import { OrderView, type OrderViewProps } from '../../[handle]/order/[token]/order-view.js';
import type { DigitalLineView } from '../../[handle]/order/[token]/digital-section.js';
import type { EditorItem, ShopLook, StoreSettings } from './store-types.js';
import checkout from '../../[handle]/shop/checkout/checkout.module.css';
import styles from './store.module.css';

/** An item's first price: its own, or its first option's, as the board's sample order takes it. */
function firstPrice(item: EditorItem): { cents: number; option: string | null } | null {
  if (item.priceCents !== null) return { cents: item.priceCents, option: null };
  const first = item.options[0];
  return first ? { cents: first.priceCents, option: first.label } : null;
}

/** What a sample digital line carries: only what the order page draws before payment. */
function digitalLine(item: EditorItem): DigitalLineView | null {
  if (item.kind !== 'DIGITAL' || item.delivery === null) return null;
  const first = item.sessions[0];
  return {
    id: item.id,
    name: item.name,
    delivery: item.delivery,
    note: null,
    hasLink: false,
    minutes: item.sessionMinutes,
    place: item.sessionPlace,
    where: null,
    startsAt: first ? first.startsAt.toISOString() : null,
    codes: [],
    files: item.files.map((f) => ({ id: f.id, name: f.name, sizeBytes: f.sizeBytes, usesLeft: 5, expiresAt: '' })),
  };
}

/**
 * The preview's Pay screen (Store board, `pay`): the real order page, given a
 * sample order of one of each of the first two items, built from the editor's
 * draft so it follows every edit. Delivery when the shop delivers, else
 * pickup, on the earliest day a customer could pick; an order of digital
 * items only has neither. The page's `preview` mode keeps it a picture:
 * nothing uploads, copies or opens.
 */
export function PayPreview({
  look,
  settings,
  items,
  qrUrl,
  hasQr,
  today,
  nextNumber,
  paysOnline = false,
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
  /** The shop's CHIP account takes payment: said in place of "no way to pay" when there is no QR or bank. */
  paysOnline?: boolean;
}) {
  const sample = items.flatMap((item) => {
    const price = firstPrice(item);
    return price ? [{ item, option: price.option, unitCents: price.cents }] : [];
  }).slice(0, 2);
  const lines = sample.map(({ item, option, unitCents }) => ({ name: item.name, option, unitCents, quantity: 1 }));
  const digitalOnly = sample.length > 0 && sample.every(({ item }) => item.kind === 'DIGITAL');
  const method = digitalOnly ? null : settings.deliveryMode === 'NONE' ? 'PICKUP' : 'DELIVERY';
  const totals = orderTotals(lines, { method: method ?? 'PICKUP', mode: settings.deliveryMode, feeCents: method === 'DELIVERY' ? settings.deliveryFeeCents : 0 });
  // Midday in Malaysia, so the day is today's there whatever the browser's zone.
  const day = method === null ? null : (openDays({ now: new Date(`${today}T04:00:00Z`), minNoticeDays: settings.minNoticeDays, closedDays: settings.closedDays }, 1)[0] ?? today);
  // A QR saved but with no address to show it from (storage off) draws nothing, so it cannot count.
  const shownQr = hasQr ? qrUrl : null;
  const order: OrderViewProps['order'] = {
    number: nextNumber,
    code: '7Q4M',
    method,
    day,
    itemsCents: totals.itemsCents,
    deliveryCents: totals.deliveryCents,
    totalCents: totals.totalCents,
    status: 'PLACED',
    receiptType: null,
    receiptUploadedAt: null,
    receiptRejectedAt: null,
    paidAt: null,
    refundedAt: null,
    lines: sample.map(({ item, option, unitCents }) => ({ itemName: item.name, optionLabel: option, unitPriceCents: unitCents, quantity: 1, digital: digitalLine(item) })),
    email: null,
    sentAt: null,
  };

  return (
    // The order page's own stage: the title on the page's colours, the sheet below it.
    <PageTheme theme={look} className={`${checkout.stage} ${styles.payStage}`}>
      <OrderView
        preview
        token="preview"
        handle={look.handle}
        displayName={look.displayName}
        language={look.language}
        order={order}
        qrUrl={shownQr}
        receiptUrl={null}
        bank={{ name: settings.bankName, accountName: settings.bankAccountName, accountNumber: settings.bankAccountNumber }}
        whatsapp={null}
        now={new Date(`${today}T04:00:00Z`).toISOString()}
        previewPaysOnline={paysOnline}
      />
    </PageTheme>
  );
}
