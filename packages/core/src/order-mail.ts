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
