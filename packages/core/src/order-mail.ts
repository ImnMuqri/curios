import { OWNER_MAIL_FOOTER, renderMailHtml } from './mail.js';
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
  method: 'PICKUP' | 'DELIVERY';
  /** The order's calendar day in Malaysia, `YYYY-MM-DD`. */
  day: string;
  note: string | null;
  lines: { itemName: string; optionLabel: string | null; quantity: number; lineCents: number }[];
  /** The owner's order screen, opened on this order. */
  url: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sat 17 Oct". The day is already a Malaysian calendar day, so it is read as written. */
function shortDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** Sent to the owner when a customer places an order, unless they switched it off. */
export function newOrderMail(o: NewOrderMailInput): Mail {
  const total = formatRinggit(o.totalCents);
  const subject = `New order #${o.number} · ${total}`;
  const heading = `${o.customerName} ordered ${total} from your shop`;
  // Not the board's "She’s paying by DuitNow QR": we know neither how they will
  // pay nor who they are (DEVIATIONS 101).
  const said = 'They pay you directly, by your QR or bank transfer. We’ll email you again when their receipt comes in.';
  const gettingIt = `${o.method === 'PICKUP' ? 'Pickup' : 'Delivery'} · ${shortDay(o.day)}`;
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
      `Total: ${total}`,
      '',
      ...facts.map(([label, value]) => `${label}: ${value}`),
      '',
      `${button}: ${o.url}`,
    ].join('\n'),
    html: renderMailHtml({
      subject,
      topRight: `Order #${o.number}`,
      tag: { label: 'Waiting for payment', tone: 'amber' },
      heading,
      blocks: [
        { kind: 'p', text: said },
        {
          kind: 'lines',
          rows: o.lines.map((l) => ({
            name: l.itemName,
            detail: [l.optionLabel, `${l.quantity}×`].filter(Boolean).join(' · '),
            amount: formatRinggit(l.lineCents),
          })),
          total: { label: 'Total', amount: total },
        },
        { kind: 'facts', rows: facts },
        { kind: 'buttons', primary: { label: button, href: o.url } },
      ],
      footer: OWNER_MAIL_FOOTER,
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
    }),
  };
}
