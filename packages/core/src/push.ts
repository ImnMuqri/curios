import { ringgit } from './money.js';

/**
 * Push notifications to an owner's phone or computer, alongside the owner emails. The api (and the
 * lead worker) queue them; apps/workers sends them with web-push to every device the account
 * turned notifications on for. They follow the device's own switch, not the "Email me when"
 * switches: an owner may want one and not the other.
 */
export const PUSH_QUEUE = 'push';

export interface PushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
  /** A later notification with the same tag replaces the earlier one, so one order is one notification. */
  tag?: string;
}

export interface PushJobData extends PushMessage {
  accountId: string;
  /** Only this device: the Settings test. Every device of the account when left out. */
  endpoint?: string;
}

/** Lock screens show a line or two; a pasted essay of a name would push the rest off. */
function short(text: string, max = 40): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

type OrderFacts = { number: number; customerName: string; totalCents: number; url: string };

/** `receipt`: the customer paid by the owner's QR first and the order came with its receipt, so this is also the one notification for it. */
export function newOrderPush(o: OrderFacts & { receipt?: boolean }): PushMessage {
  if (o.receipt) {
    return {
      title: `New order #${o.number} · receipt to check`,
      body: `${short(o.customerName)} · ${ringgit(o.totalCents)}. Check the receipt and mark it paid.`,
      url: o.url,
      tag: `order-${o.number}`,
    };
  }
  return { title: `New order #${o.number}`, body: `${short(o.customerName)} · ${ringgit(o.totalCents)}`, url: o.url, tag: `order-${o.number}` };
}

export function paidOrderPush(o: OrderFacts & { kind: 'paid' | 'paid-after-cancel' | 'paid-twice' }): PushMessage {
  const title =
    o.kind === 'paid-twice'
      ? `Order #${o.number} was paid twice`
      : o.kind === 'paid-after-cancel'
        ? `Order #${o.number} was paid after you cancelled it`
        : `Order #${o.number} is paid`;
  const body = o.kind === 'paid' ? `${short(o.customerName)} paid ${ringgit(o.totalCents)} online.` : 'Open the order to sort it out.';
  return { title, body, url: o.url, tag: `order-${o.number}` };
}

export function receiptPush(o: OrderFacts): PushMessage {
  return {
    title: `Receipt for order #${o.number}`,
    body: `${short(o.customerName)} · ${ringgit(o.totalCents)}. Check it and mark it paid.`,
    url: o.url,
    tag: `order-${o.number}`,
  };
}

/** Never the phone number: a lock screen is read by whoever holds the phone. */
export function leadPush(l: { name: string | null; about: string | null; url: string }): PushMessage {
  return {
    title: `${l.name ? short(l.name, 30) : 'Someone'} left their number`,
    body: l.about ? `About: ${short(l.about)}. Reply while it’s warm.` : 'Open Leads to reply while it’s warm.',
    url: l.url,
  };
}

export function testPush(url: string): PushMessage {
  return { title: 'Notifications are on', body: 'New orders, receipts and leads will show here.', url, tag: 'test' };
}
