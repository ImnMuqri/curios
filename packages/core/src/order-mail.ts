import { OWNER_MAIL_FOOTER, renderMailHtml } from './mail.js';
import { isRiderDelivery } from './orders.js';
import { formatMalaysianPhone } from './phone.js';
import { formatRinggit } from './store.js';

/**
 * The emails about a shop's orders, from the Emails board's "New order". The
 * owner's, so the footer says where to switch them off (Page.notifyOrders).
 */

interface Mail {
  subject: string;
  text: string;
  html: string;
}

export interface NewOrderMailInput {
  number: number;
  totalCents: number;
  customerName: string;
  /** E.164, as stored. */
  phone: string;
  /** Null for a digital-only order: it reaches the buyer by email. */
  method: 'PICKUP' | 'DELIVERY' | null;
  /** Sen. None on a delivery means a rider, paid separately (isRiderDelivery). */
  deliveryCents: number;
  /** The order's calendar day in Malaysia, `YYYY-MM-DD`. */
  day: string | null;
  note: string | null;
  lines: { itemName: string; optionLabel: string | null; quantity: number; lineCents: number }[];
  /** The owner's order screen, opened on this order. */
  url: string;
  /** The site's address, where the wordmark image is hosted. */
  appUrl?: string;
  /** What the order's voucher took off, in sen; 0 or absent for none. `totalCents` is already less it. */
  discountCents?: number;
  /** The voucher's code or name, as the order keeps it. */
  voucherLabel?: string | null;
  /** A voucher took the total to RM0, so the order was paid as it was placed (and a digital one sent). */
  paidWithVoucher?: boolean;
}

/** What a voucher took off, as one row above the total ("RAYA10 −RM9.50"); null with no discount. */
export function voucherRow(o: { discountCents?: number; voucherLabel?: string | null }): { name: string; detail: string; amount: string } | null {
  if (!o.discountCents) return null;
  return { name: o.voucherLabel || 'Voucher', detail: 'Voucher', amount: `−${formatRinggit(o.discountCents)}` };
}

/**
 * The delivery fee, as one row under the lines ("Delivery RM8"), so the rows add up to the total; null with
 * none (a pickup, a digital order, or a rider delivery, which the customer pays the rider for).
 */
export function deliveryRow(o: { deliveryCents?: number }): { name: string; detail: string; amount: string } | null {
  if (!o.deliveryCents) return null;
  return { name: 'Delivery', detail: '', amount: formatRinggit(o.deliveryCents) };
}

/** The amount rows in a plain-text email, under the lines: "Delivery: RM8", "RAYA10: −RM9.50". */
export const rowsText = (...rows: ReturnType<typeof voucherRow>[]): string[] => rows.flatMap((row) => (row ? [`${row.name}: ${row.amount}`] : []));

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sat 17 Oct". The day is already a Malaysian calendar day, so it is read as written. */
function shortDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** Sent to the owner when a customer places an order, unless they switched it off. */
export function newOrderMail(o: NewOrderMailInput): Mail {
  const total = formatRinggit(o.totalCents);
  const free = o.paidWithVoucher === true;
  const subject = free ? `New order #${o.number} · ${total} · Paid` : `New order #${o.number} · ${total}`;
  const heading = free ? `${o.customerName} ordered from your shop with a voucher` : `${o.customerName} ordered ${total} from your shop`;
  // Not the board's "She’s paying by DuitNow QR": we know neither how they will
  // pay nor who they are (DEVIATIONS 101). A free order has nothing to pay at all.
  const said = free
    ? `A voucher covered the whole order, so there’s nothing to pay and no receipt to check. ${o.method === null || o.day === null ? 'Their digital items were sent to them straight away.' : 'Just get it ready.'}`
    : 'They pay you directly, by your QR or bank transfer. We’ll email you again when their receipt comes in.';
  const voucher = voucherRow(o);
  const delivery = deliveryRow(o);
  const totalLabel = free ? 'Paid' : 'Total';
  const gettingIt =
    o.method === null || o.day === null
      ? 'By email'
      : `${o.method === 'PICKUP' ? 'Pickup' : 'Delivery'} · ${shortDay(o.day)}${isRiderDelivery({ method: o.method, deliveryCents: o.deliveryCents }) ? ' · Rider fee paid separately' : ''}`;
  const customer = `${o.customerName} · ${formatMalaysianPhone(o.phone)}`;
  const facts: [string, string][] = [
    ['Getting it', gettingIt],
    ['Customer', customer],
    ...(o.note ? ([['Note', o.note]] as [string, string][]) : []),
  ];
  const button = `Open order #${o.number}`;

  return {
    subject,
    text: [
      `${heading}.`,
      '',
      said,
      '',
      ...o.lines.map((l) => `${[l.itemName, l.optionLabel].filter(Boolean).join(', ')}, ${l.quantity}×: ${formatRinggit(l.lineCents)}`),
      ...rowsText(delivery, voucher),
      `${totalLabel}: ${total}`,
      '',
      ...facts.map(([label, value]) => `${label}: ${value}`),
      '',
      `${button}: ${o.url}`,
    ].join('\n'),
    html: renderMailHtml({
      subject,
      topRight: `Order #${o.number}`,
      tag: free ? { label: 'Paid with a voucher', tone: 'hijau' } : { label: 'Waiting for payment', tone: 'amber' },
      heading,
      blocks: [
        { kind: 'p', text: said },
        {
          kind: 'lines',
          rows: [
            ...o.lines.map((l) => ({
              name: l.itemName,
              detail: [l.optionLabel, `${l.quantity}×`].filter(Boolean).join(' · '),
              amount: formatRinggit(l.lineCents),
            })),
            ...(delivery ? [delivery] : []),
            ...(voucher ? [voucher] : []),
          ],
          total: { label: totalLabel, amount: total },
        },
        { kind: 'facts', rows: facts },
        { kind: 'buttons', primary: { label: button, href: o.url } },
      ],
      footer: OWNER_MAIL_FOOTER,
      appUrl: o.appUrl,
    }),
  };
}

export interface PaidOrderMailInput extends Omit<NewOrderMailInput, 'note' | 'method' | 'day' | 'paidWithVoucher'> {
  method: 'PICKUP' | 'DELIVERY';
  day: string;
  /** How CHIP says it was paid, as stored: "FPX · Maybank2u". */
  via: string;
  /** CHIP's reference, when it gave one. */
  ref: string | null;
}

/**
 * Sent to the owner when CHIP confirms a customer's online payment, unless they
 * switched order emails off. The Emails board's "Paid order": nothing to check.
 */
export function paidOrderMail(o: PaidOrderMailInput): Mail {
  const total = formatRinggit(o.totalCents);
  const subject = `New order #${o.number} · ${total} · Paid`;
  const tag = `Paid by ${o.via.split(' · ')[0]}`;
  const heading = `${o.customerName} ordered and paid ${total}`;
  const weekday = WEEKDAY_NAMES[new Date(`${o.day}T00:00:00Z`).getUTCDay()];
  const said = `The bank confirmed it through CHIP, so there’s nothing to check. Just get it ready for ${weekday}.`;
  const small = 'The money is in your CHIP account. CHIP pays it out to your bank on its usual schedule.';
  const gettingIt = `${o.method === 'PICKUP' ? 'Pickup' : 'Delivery'} · ${shortDay(o.day)}${isRiderDelivery(o) ? ' · Rider fee paid separately' : ''}`;
  const facts: [string, string][] = [
    ['Getting it', gettingIt],
    ['Customer', `${o.customerName} · ${formatMalaysianPhone(o.phone)}`],
    ['Paid with', o.ref ? `${o.via} · Ref ${o.ref}` : o.via],
  ];
  const button = `Open order #${o.number}`;
  const voucher = voucherRow(o);
  const delivery = deliveryRow(o);

  return {
    subject,
    text: [
      `${heading}.`,
      '',
      said,
      '',
      ...o.lines.map((l) => `${[l.itemName, l.optionLabel].filter(Boolean).join(', ')}, ${l.quantity}×: ${formatRinggit(l.lineCents)}`),
      ...rowsText(delivery, voucher),
      `Paid: ${total}`,
      '',
      ...facts.map(([label, value]) => `${label}: ${value}`),
      '',
      `${button}: ${o.url}`,
      '',
      small,
    ].join('\n'),
    html: renderMailHtml({
      subject,
      topRight: `Order #${o.number}`,
      tag: { label: tag, tone: 'hijau' },
      heading,
      blocks: [
        { kind: 'p', text: said },
        {
          kind: 'lines',
          rows: [
            ...o.lines.map((l) => ({
              name: l.itemName,
              detail: [l.optionLabel, `${l.quantity}×`].filter(Boolean).join(' · '),
              amount: formatRinggit(l.lineCents),
            })),
            ...(delivery ? [delivery] : []),
            ...(voucher ? [voucher] : []),
          ],
          total: { label: 'Paid', amount: total },
        },
        { kind: 'facts', rows: facts },
        { kind: 'buttons', primary: { label: button, href: o.url } },
        { kind: 'small', text: small },
      ],
      footer: OWNER_MAIL_FOOTER,
      appUrl: o.appUrl,
    }),
  };
}

export interface PaidAfterCancelMailInput {
  number: number;
  totalCents: number;
  customerName: string;
  via: string;
  url: string;
  appUrl?: string;
}

/**
 * Sent to the owner when a customer's online payment lands after the owner
 * cancelled the order. No board draws it (DEVIATIONS 183).
 */
export function paidAfterCancelMail(o: PaidAfterCancelMailInput): Mail {
  const total = formatRinggit(o.totalCents);
  const subject = `Order #${o.number} was paid after you cancelled it`;
  const said = `${o.customerName} paid ${total} by ${o.via} after you cancelled it. Refund them in CHIP, then mark it refunded in Orders.`;
  const button = `Open order #${o.number}`;

  return {
    subject,
    text: [`${subject}.`, '', said, '', `${button}: ${o.url}`].join('\n'),
    html: renderMailHtml({
      subject,
      topRight: `Order #${o.number}`,
      tag: { label: 'Refund owed', tone: 'merah' },
      heading: subject,
      blocks: [
        { kind: 'p', text: said },
        { kind: 'buttons', primary: { label: button, href: o.url } },
      ],
      footer: OWNER_MAIL_FOOTER,
      appUrl: o.appUrl,
    }),
  };
}

export interface PaidTwiceMailInput {
  number: number;
  totalCents: number;
  customerName: string;
  /** How CHIP was paid: "FPX · Maybank2u". */
  via: string;
  /** The payment that came first: the owner's QR (a receipt was checked), or marked paid by hand. */
  first: 'qr' | 'hand';
  url: string;
  appUrl?: string;
}

/**
 * Sent to the owner when CHIP takes a payment for an order already paid another way
 * (the QR, or marked paid by hand). No board draws it (DEVIATIONS 187).
 */
export function paidTwiceMail(o: PaidTwiceMailInput): Mail {
  const total = formatRinggit(o.totalCents);
  const subject = `Order #${o.number} was paid twice`;
  const said = `${o.customerName} paid ${total} by ${o.via} on top of the ${o.first === 'qr' ? 'QR' : 'hand-marked'} payment. Refund one of them in CHIP.`;
  const button = `Open order #${o.number}`;

  return {
    subject,
    text: [`${subject}.`, '', said, '', `${button}: ${o.url}`].join('\n'),
    html: renderMailHtml({
      subject,
      topRight: `Order #${o.number}`,
      tag: { label: 'Paid twice', tone: 'merah' },
      heading: subject,
      blocks: [
        { kind: 'p', text: said },
        { kind: 'buttons', primary: { label: button, href: o.url } },
      ],
      footer: OWNER_MAIL_FOOTER,
      appUrl: o.appUrl,
    }),
  };
}

export interface ReceiptMailInput {
  number: number;
  totalCents: number;
  customerName: string;
  uploadedAt: Date;
  /** The stored file's name, for the board's "File" row; never its URL. */
  fileName: string;
  /** The owner's order screen, opened on this order. */
  url: string;
  /** The site's address, where the wordmark image is hosted. */
  appUrl?: string;
}

/** "Thu 15 Oct, 3:42pm", Malaysian time (UTC+8, no daylight saving). */
function shortDayTime(at: Date): string {
  const my = new Date(at.getTime() + 8 * 3_600_000);
  const hour = my.getUTCHours();
  const minute = String(my.getUTCMinutes()).padStart(2, '0');
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}:${minute}${hour < 12 ? 'am' : 'pm'}`;
  return `${WEEKDAYS[my.getUTCDay()]} ${my.getUTCDate()} ${MONTHS[my.getUTCMonth()]}, ${clock}`;
}

/** Sent to the owner when a customer uploads a receipt, unless they switched it off. */
export function receiptMail(o: ReceiptMailInput): Mail {
  const total = formatRinggit(o.totalCents);
  const subject = `Receipt uploaded for #${o.number}`;
  const heading = `${o.customerName} sent a receipt for order #${o.number}`;
  // The board says "Aisyah sees ... her order page"; we do not know their pronoun (DEVIATIONS 101).
  const said = `Check that ${total} reached your account, then confirm the order. ${o.customerName} sees the update on their order page.`;
  const small = `Didn’t get the money? Open the order and mark it as not received. ${o.customerName} will be asked to try again.`;
  const facts: [string, string][] = [
    ['Order', `#${o.number} · ${total}`],
    ['From', o.customerName],
    ['Sent', shortDayTime(o.uploadedAt)],
    ['File', o.fileName],
  ];
  const button = 'Check the receipt';

  return {
    subject,
    text: [`${heading}.`, '', said, '', ...facts.map(([label, value]) => `${label}: ${value}`), '', `${button}: ${o.url}`, '', small].join('\n'),
    html: renderMailHtml({
      subject,
      topRight: `Order #${o.number}`,
      tag: { label: 'Receipt to check', tone: 'biru' },
      heading,
      blocks: [
        { kind: 'p', text: said },
        { kind: 'facts', rows: facts },
        { kind: 'buttons', primary: { label: button, href: o.url } },
        { kind: 'small', text: small },
      ],
      footer: OWNER_MAIL_FOOTER,
      appUrl: o.appUrl,
    }),
  };
}
