import { ChipRefusedError, DEAD_PURCHASE_STATUSES, wasPaid, type ChipClient, type ChipPurchase, type PurchaseProduct } from '@curios/billing';
import { hashSessionValue, MAIL_QUEUE, paidAfterCancelMail, paidOrderMail, paidTwiceMail } from '@curios/core';
import { openSecret } from '@curios/core/secret-box';
import { chipWhitelist, choiceLabel, onlineOffer, paidMethodLabel, payUrl, type OnlineChoice, type OnlineOffer } from '@curios/core/shop-pay';
import type { PrismaClient } from '@curios/db';
import { errName } from '../billing/billing.service.js';
import { PageUnavailableError } from '../pages/page-unavailable.js';
import type { AvatarStore } from '../pages/storage.js';
import type { ChipClientFor } from '../store/chip.service.js';
import { EmailRequiredError, OrderAlreadyPaidError, OrderCancelledError, OrderJustPaidError, OrderNotFoundError, OrderReceiptSentError } from './order.errors.js';
import type { OrderMailQueue } from './place.service.js';

type Log = {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

/**
 * What CHIP's `GET /payment_methods/` said for one shop at one amount, kept a
 * few minutes: checkout asks as the basket changes, and paying asks again.
 */
export class MethodsCache {
  private readonly entries = new Map<string, { methods: string[]; until: number }>();
  constructor(
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly max = 1000,
  ) {}

  get(key: string, now: number): string[] | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.until <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.methods;
  }

  set(key: string, methods: string[], now: number): void {
    // Bounded: the oldest goes first. Amounts are the visitor's to vary.
    if (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { methods, until: now + this.ttlMs });
  }
}

/**
 * The last thing CHIP said about each order's purchase, so the order page's checks ask
 * CHIP about one order at most once every few seconds however often the page asks.
 */
export class LookupCache {
  private readonly entries = new Map<string, { at: number; status: PayStatus }>();
  constructor(
    readonly everyMs = 5000,
    private readonly max = 5000,
  ) {}

  recent(orderId: string, now: number): PayStatus | undefined {
    const entry = this.entries.get(orderId);
    return entry && now - entry.at < this.everyMs ? entry.status : undefined;
  }

  keep(orderId: string, status: PayStatus, now: number): void {
    if (this.everyMs <= 0) return;
    if (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(orderId, { at: now, status });
  }
}

export interface PayOnlineDeps {
  prisma: PrismaClient;
  clientFor: ChipClientFor;
  /** PAYMENT_SECRETS_KEY; null where connecting CHIP is switched off, so nothing can be paid online. */
  secretsKey: Buffer | null;
  production: boolean;
  appUrl: string;
  /** Where CHIP calls back (CHIP_CALLBACK_BASE_URL); null leaves the callback out, and the order page's check settles it. */
  callbackBaseUrl: string | null;
  store: AvatarStore | null;
  /** The owner's emails; a function because the queue is built after the settings are read. */
  mailQueue: () => OrderMailQueue;
  methods: MethodsCache;
  lookups: LookupCache;
  log: Log;
}

/** A shop's CHIP account, as paying reads it. Never sent anywhere. */
interface ShopAccount {
  pageId: string;
  brandId: string;
  secretKeyCiphertext: string;
  isTest: boolean;
  lastErrorAt: Date | null;
  brandName: string | null;
}

const ACCOUNT_SELECT = { pageId: true, brandId: true, secretKeyCiphertext: true, isTest: true, lastErrorAt: true, brandName: true } as const;

/** One hour to pay, then the purchase stops being payable (due_strict). */
const PAY_WINDOW_MS = 60 * 60 * 1000;

const markRefused = (deps: PayOnlineDeps, pageId: string, now: Date) =>
  deps.prisma.shopPaymentAccount.updateMany({ where: { pageId }, data: { lastErrorAt: now } });

/**
 * The owner's own CHIP client, or null when their key cannot be opened: no
 * PAYMENT_SECRETS_KEY here, or the key was sealed under one that has since
 * changed. An unopenable key is marked, as a refused one is, so the owner's
 * Store can say so and checkout stops offering it.
 */
async function openOwnerClient(deps: PayOnlineDeps, account: ShopAccount, now: Date): Promise<ChipClient | null> {
  if (!deps.secretsKey) return null;
  let secretKey: string;
  try {
    secretKey = openSecret(account.secretKeyCiphertext, deps.secretsKey);
  } catch (error) {
    deps.log.warn({ pageId: account.pageId, err: errName(error) }, 'shop chip key could not be opened');
    await markRefused(deps, account.pageId, now);
    return null;
  }
  return deps.clientFor({ secretKey, brandId: account.brandId });
}

/**
 * Whether this account may take a customer's money now: not after CHIP refused
 * its key (until the owner connects again or the RM1 test passes), and never a
 * test key in production, where it would take orders that move no money.
 */
function canTakePayment(deps: PayOnlineDeps, account: ShopAccount): boolean {
  return account.lastErrorAt === null && !(deps.production && account.isTest);
}

/** A 401 or 403 means the owner's key no longer works; it is marked so checkout stops offering it. */
async function noteRefusal(deps: PayOnlineDeps, account: ShopAccount, error: unknown, now: Date): Promise<void> {
  if (error instanceof ChipRefusedError && (error.status === 401 || error.status === 403)) await markRefused(deps, account.pageId, now);
}

/** The account's methods at this amount, from the cache or from CHIP; null when CHIP cannot say. */
async function methodsAt(deps: PayOnlineDeps, account: ShopAccount, client: ChipClient, amountCents: number, now: Date): Promise<string[] | null> {
  const key = `${account.pageId}:${amountCents}`;
  const cached = deps.methods.get(key, now.getTime());
  if (cached) return cached;
  try {
    const methods = await client.listPaymentMethods(amountCents);
    deps.methods.set(key, methods, now.getTime());
    return methods;
  } catch (error) {
    // The name only: a refused call's message carries CHIP's response body.
    deps.log.warn({ pageId: account.pageId, err: errName(error) }, 'shop chip methods could not be read');
    await noteRefusal(deps, account, error, now);
    return null;
  }
}

const NOTHING_ONLINE: OnlineOffer = { fpx: false, wallets: [], card: false };

/** What checkout may offer online for this shop at this total: the board's choices CHIP lists for the owner's key. */
export async function payMethodsFor(deps: PayOnlineDeps, handle: string, amountCents: number, now: Date): Promise<OnlineOffer> {
  const page = await deps.prisma.page.findUnique({
    where: { handle: handle.toLowerCase() },
    select: { mode: true, storeEnabled: true, suspendedAt: true, paymentAccount: { select: ACCOUNT_SELECT } },
  });
  const account = page?.paymentAccount;
  if (!page || page.suspendedAt !== null || page.mode !== 'BUSINESS' || !page.storeEnabled || !account || !canTakePayment(deps, account)) return NOTHING_ONLINE;
  const client = await openOwnerClient(deps, account, now);
  if (!client) return NOTHING_ONLINE;
  const methods = await methodsAt(deps, account, client, amountCents, now);
  return methods ? onlineOffer(methods) : NOTHING_ONLINE;
}

/** CHIP's phone form, `+60 123456789`, from the order's E.164. */
const chipPhone = (phone: string) => phone.replace(/^\+60/, '+60 ');

const refuseFor = (status: string): void => {
  if (status === 'PAID' || status === 'COMPLETED') throw new OrderAlreadyPaidError();
  if (status === 'CANCELLED') throw new OrderCancelledError();
};

/**
 * Starts paying a placed order online, through the owner's own CHIP account.
 * The order is placed already, exactly as for the QR; this only creates a
 * purchase for it on the owner's brand with the owner's key and answers where
 * to send the customer. `{ url: null }` says online payment is not available
 * right now (CHIP down, the key refused or unopenable, a test key in
 * production, a method not offered): the order stays placed, and checkout
 * offers the owner's QR instead.
 */
export async function startOnlinePayment(
  deps: PayOnlineDeps,
  token: string,
  /** `email` may be left out when the order has its own (a digital order's buyer already gave one). */
  input: OnlineChoice & { email?: string },
  now: Date,
): Promise<{ url: string | null }> {
  const order = await deps.prisma.order.findUnique({
    where: { tokenHash: hashSessionValue(token) },
    select: {
      id: true,
      number: true,
      status: true,
      totalCents: true,
      deliveryCents: true,
      customerName: true,
      phone: true,
      email: true,
      chipPurchaseId: true,
      receiptKey: true,
      lines: { orderBy: { position: 'asc' }, select: { itemName: true, optionLabel: true, unitPriceCents: true, quantity: true } },
      page: { select: { handle: true, displayName: true, mode: true, suspendedAt: true, paymentAccount: { select: ACCOUNT_SELECT } } },
    },
  });
  if (!order || order.page.mode !== 'BUSINESS') throw new OrderNotFoundError();
  // Paying a suspended page's order is refused; the order itself stays readable, and a payment already made still settles.
  if (order.page.suspendedAt !== null) throw new PageUnavailableError();
  refuseFor(order.status);
  // CHIP's receipt goes to the email typed for it, or else to the one the order was placed with.
  const payerEmail = input.email ?? order.email;
  if (!payerEmail) throw new EmailRequiredError();
  // A receipt is with the shop to check: a second payment now would leave two for one order.
  if (order.receiptKey) throw new OrderReceiptSentError(order.page.displayName);
  const unavailable = (reason: string) => {
    deps.log.info({ orderId: order.id, reason }, 'online payment not available');
    return { url: null };
  };

  const account = order.page.paymentAccount;
  if (!account) return unavailable('not connected');
  if (!canTakePayment(deps, account)) return unavailable('account cannot take payment');
  const client = await openOwnerClient(deps, account, now);
  if (!client) return unavailable('key cannot be opened');

  // A purchase from an earlier attempt: if it was paid, that pays the order, and a
  // second purchase would charge the customer twice. So nothing new is made unless the
  // earlier one is known to be dead, or is cancelled here; anything less is unavailable.
  const previousId = order.chipPurchaseId;
  if (previousId) {
    const settled = async (purchase: ChipPurchase) => {
      const outcome = await settleChipPurchase(deps, { ...order, pageId: account.pageId }, purchase, now);
      if (outcome === 'paid' || outcome === 'already-paid' || outcome === 'paid-twice') throw new OrderAlreadyPaidError();
    };
    let previous: ChipPurchase;
    try {
      previous = await client.getPurchase(previousId);
    } catch (error) {
      deps.log.warn({ orderId: order.id, purchaseId: previousId, err: errName(error) }, 'earlier order purchase could not be checked');
      return unavailable('earlier purchase unknown');
    }
    if (wasPaid(previous.status)) {
      await settled(previous);
      return unavailable('earlier purchase paid but not this order');
    }
    // Overdue counts as dead for the order page, but CHIP may still take it: it is cancelled too.
    if (!DEAD_PURCHASE_STATUSES.has(previous.status) || previous.status === 'overdue') {
      try {
        await client.cancelPurchase(previousId);
      } catch (error) {
        deps.log.warn({ orderId: order.id, purchaseId: previousId, err: errName(error) }, 'earlier order purchase could not be cancelled');
        // Most likely paid in between: look again, and settle it if so.
        const again = await client.getPurchase(previousId).catch(() => null);
        if (again && wasPaid(again.status)) await settled(again);
        return unavailable('earlier purchase could not be cancelled');
      }
    }
  }

  const methods = await methodsAt(deps, account, client, order.totalCents, now);
  if (!methods) return unavailable('methods unknown');
  if (payUrl('', input, methods) === null) return unavailable('method not offered');

  const products: PurchaseProduct[] = order.lines.map((line) => ({
    name: (line.optionLabel ? `${line.itemName} (${line.optionLabel})` : line.itemName).slice(0, 256),
    priceCents: line.unitPriceCents,
    quantity: line.quantity,
  }));
  if (order.deliveryCents > 0) products.push({ name: 'Delivery', priceCents: order.deliveryCents, quantity: 1 });
  const sum = products.reduce((total, product) => total + product.priceCents * product.quantity, 0);
  if (sum !== order.totalCents) {
    deps.log.error({ orderId: order.id }, 'order lines do not add up to its total');
    return unavailable('total mismatch');
  }

  const dueAt = new Date(now.getTime() + PAY_WINDOW_MS);
  let purchase: ChipPurchase;
  try {
    purchase = await client.createPurchase({
      email: payerEmail,
      fullName: order.customerName,
      phone: chipPhone(order.phone),
      productName: `Order #${order.number}`,
      amountCents: order.totalCents,
      products,
      reference: String(order.number),
      notes: choiceLabel(input),
      ...(deps.callbackBaseUrl ? { successCallback: `${deps.callbackBaseUrl}/store/chip/callback/${order.id}` } : {}),
      redirectUrl: `${deps.appUrl}/${order.page.handle}/order/${token}`,
      dueAt,
      sendReceipt: true,
      cardsOnlyRecurring: false,
      methods: chipWhitelist(methods),
    });
  } catch (error) {
    deps.log.warn({ orderId: order.id, err: errName(error) }, 'order purchase could not be created');
    await noteRefusal(deps, account, error, now);
    return unavailable('purchase refused');
  }

  // Defence in depth: connecting refuses a test key in production, but a key CHIP
  // later calls a test one must never take a real order's payment.
  if (deps.production && purchase.isTest) {
    await client.cancelPurchase(purchase.id).catch((error: unknown) =>
      deps.log.warn({ orderId: order.id, purchaseId: purchase.id, err: errName(error) }, 'test order purchase could not be cancelled'),
    );
    await deps.prisma.shopPaymentAccount.updateMany({ where: { pageId: account.pageId }, data: { isTest: true, lastErrorAt: now } });
    return unavailable('test purchase in production');
  }
  if (purchase.isTest !== account.isTest || (purchase.brandName && purchase.brandName !== account.brandName)) {
    await deps.prisma.shopPaymentAccount.updateMany({
      where: { pageId: account.pageId },
      data: { isTest: purchase.isTest, ...(purchase.brandName ? { brandName: purchase.brandName } : {}) },
    });
  }

  // Kept only over the purchase this attempt started from: two attempts at once both
  // make one, and only one of them may stay on the order.
  const { count } = await deps.prisma.order.updateMany({
    where: { id: order.id, status: 'PLACED', chipPurchaseId: previousId },
    data: { chipPurchaseId: purchase.id, chipPurchaseDueAt: dueAt, payerEmail },
  });
  if (count === 0) {
    // Another attempt won, or the order moved on (the owner cancelled, or it was paid).
    await client.cancelPurchase(purchase.id).catch((error: unknown) =>
      deps.log.warn({ orderId: order.id, purchaseId: purchase.id, err: errName(error) }, 'lost order purchase could not be cancelled'),
    );
    const current = await deps.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
    refuseFor(current.status);
    return unavailable('another attempt was kept');
  }
  deps.log.info({ orderId: order.id, purchaseId: purchase.id }, 'order purchase created');

  const url = payUrl(purchase.checkoutUrl, input, methods);
  return { url };
}

export type SettleOutcome =
  | 'paid'
  | 'already-paid'
  | 'paid-after-cancel'
  | 'paid-twice'
  | 'pending'
  | 'failed'
  | 'mismatch'
  | 'test-refused'
  | 'not-placed';

/**
 * Applies what CHIP says about an order's purchase, fetched with the owner's
 * key: PLACED → PAID only when the purchase is the one this order holds, was
 * paid (paid, cleared or settled; or refunded or charged back since), carries this order's number as its reference and this order's total,
 * and (in production) is not a test. One conditional update, so a repeat, or a
 * callback and the order page at once, changes nothing the second time.
 */
export async function settleChipPurchase(
  deps: PayOnlineDeps,
  order: { id: string; number: number; totalCents: number; chipPurchaseId: string | null; pageId: string },
  purchase: ChipPurchase,
  now: Date,
): Promise<SettleOutcome> {
  if (!order.chipPurchaseId || purchase.id !== order.chipPurchaseId) return 'mismatch';
  if (
    purchase.reference !== String(order.number) ||
    purchase.totalCents !== order.totalCents ||
    (purchase.currency !== undefined && purchase.currency !== 'MYR')
  ) {
    deps.log.warn({ orderId: order.id, purchaseId: purchase.id }, 'order purchase does not match its order');
    return 'mismatch';
  }
  if (deps.production && purchase.isTest) {
    deps.log.warn({ orderId: order.id, purchaseId: purchase.id }, 'test purchase refused in production');
    return 'test-refused';
  }
  if (!wasPaid(purchase.status)) return DEAD_PURCHASE_STATUSES.has(purchase.status) ? 'failed' : 'pending';

  const paid = {
    paidAt: now,
    paidVia: 'CHIP' as const,
    paidMethodLabel: paidMethodLabel(purchase),
    // CHIP's own reference, or none: the purchase id is not a reference to show anyone.
    paidRef: purchase.referenceGenerated ?? null,
  };
  // A receipt already sent is the customer's first payment (the API refuses to start an
  // online one after it, so this is a race): it is never erased. The first update takes
  // an order with no receipt; the second, one with a receipt, keeps it and records CHIP's
  // payment beside it as a second payment.
  const { count } = await deps.prisma.order.updateMany({
    where: { id: order.id, status: 'PLACED', chipPurchaseId: purchase.id, receiptKey: null },
    data: { status: 'PAID', ...paid },
  });
  if (count === 1) {
    // The one moment the order becomes PAID through CHIP, and it happens once: so the
    // owner's "paid" email is sent from here and nowhere else.
    await mailOwner(deps, order.id, 'paid');
    return 'paid';
  }
  const withReceipt = await deps.prisma.order.updateMany({
    where: { id: order.id, status: 'PLACED', chipPurchaseId: purchase.id, receiptKey: { not: null } },
    data: { status: 'PAID', ...paid, chipPaidTwiceAt: now },
  });
  if (withReceipt.count === 1) {
    deps.log.warn({ orderId: order.id, purchaseId: purchase.id }, 'order paid online after a receipt was sent');
    await mailOwner(deps, order.id, 'paid-twice', paid.paidMethodLabel, 'qr');
    return 'paid-twice';
  }
  const after = await deps.prisma.order.findUnique({ where: { id: order.id }, select: { status: true, paidVia: true } });
  if (after && (after.status === 'PAID' || after.status === 'COMPLETED')) {
    if (after.paidVia === 'CHIP') return 'already-paid';
    // Paid another way first (the QR, or by hand), and now CHIP took the money too: the
    // customer paid twice. Recorded once, beside the first payment, which stands; the
    // owner is told, once, to refund one of them in CHIP.
    const twice = await deps.prisma.order.updateMany({
      where: {
        id: order.id,
        status: { in: ['PAID', 'COMPLETED'] },
        OR: [{ paidVia: null }, { paidVia: { not: 'CHIP' } }],
        chipPaidTwiceAt: null,
        chipPurchaseId: purchase.id,
      },
      data: { chipPaidTwiceAt: now },
    });
    if (twice.count === 1) {
      deps.log.warn({ orderId: order.id, purchaseId: purchase.id }, 'order paid online after it was paid another way');
      await mailOwner(deps, order.id, 'paid-twice', paid.paidMethodLabel);
      return 'paid-twice';
    }
    return 'already-paid';
  }
  // Paid at CHIP after the owner cancelled: recorded on the cancelled order, which then
  // reads as a refund owed (orderView). The money is in the owner's CHIP account, so the
  // owner is told, once, to refund it there.
  const late = await deps.prisma.order.updateMany({
    where: { id: order.id, status: 'CANCELLED', paidAt: null, chipPurchaseId: purchase.id },
    data: paid,
  });
  if (late.count === 1) {
    deps.log.warn({ orderId: order.id, purchaseId: purchase.id }, 'order paid online after it was cancelled');
    await mailOwner(deps, order.id, 'paid-after-cancel');
    return 'paid-after-cancel';
  }
  if (after?.status === 'CANCELLED') return 'already-paid';
  deps.log.warn({ orderId: order.id, purchaseId: purchase.id }, 'order paid online but no longer placed');
  return 'not-placed';
}

/**
 * Tells the owner an order was paid online (or paid after they cancelled it), under the
 * same switch as the new-order email (Page.notifyOrders). Called from the one conditional
 * update that changes the order, so once per order. Queued, not awaited, like every order
 * email; a failure of any kind is logged with ids only and never reaches the caller.
 */
async function mailOwner(deps: PayOnlineDeps, orderId: string, kind: 'paid' | 'paid-after-cancel' | 'paid-twice', twiceVia?: string | null, twiceFirst?: 'qr' | 'hand'): Promise<void> {
  try {
    const order = await deps.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        number: true,
        totalCents: true,
        customerName: true,
        phone: true,
        method: true,
        day: true,
        deliveryCents: true,
        paidMethodLabel: true,
        paidRef: true,
        paidVia: true,
        lines: { orderBy: { position: 'asc' }, select: { itemName: true, optionLabel: true, unitPriceCents: true, quantity: true } },
        page: { select: { notifyOrders: true, account: { select: { email: true } } } },
      },
    });
    if (!order?.page.notifyOrders) return;
    // A digital-only order has no method or day for this email; its owner mail comes with the digital emails.
    const { method, day } = order;
    if (kind === 'paid' && (method === null || day === null)) return;
    const base = { number: order.number, totalCents: order.totalCents, customerName: order.customerName, via: order.paidMethodLabel ?? 'CHIP' };
    const url = `${deps.appUrl.replace(/\/+$/, '')}/app/orders?order=${orderId}`;
    const mail =
      kind === 'paid-twice'
        ? // The order's own paid fields are the first payment's; CHIP's way of paying comes from the purchase.
          paidTwiceMail({ ...base, via: twiceVia ?? 'CHIP', first: twiceFirst ?? (order.paidVia === 'RECEIPT' ? 'qr' : 'hand'), url, appUrl: deps.appUrl })
        : kind === 'paid'
        ? paidOrderMail({
            ...base,
            phone: order.phone,
            method: method as 'PICKUP' | 'DELIVERY',
            deliveryCents: order.deliveryCents,
            day: (day as Date).toISOString().slice(0, 10),
            ref: order.paidRef,
            lines: order.lines.map((l) => ({ itemName: l.itemName, optionLabel: l.optionLabel, quantity: l.quantity, lineCents: l.unitPriceCents * l.quantity })),
            url,
            appUrl: deps.appUrl,
          })
        : paidAfterCancelMail({ ...base, url, appUrl: deps.appUrl });
    const warn = (error: unknown) => deps.log.warn({ orderId, err: errName(error) }, 'could not queue the order-paid email');
    void deps.mailQueue()
      .add(MAIL_QUEUE, { to: order.page.account.email, ...mail }, { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true })
      .catch(warn);
  } catch (error) {
    deps.log.warn({ orderId, err: errName(error) }, 'could not queue the order-paid email');
  }
}

const ORDER_FOR_SETTLE = {
  id: true,
  number: true,
  status: true,
  totalCents: true,
  chipPurchaseId: true,
  chipPurchaseDueAt: true,
  pageId: true,
  paidAt: true,
  paidMethodLabel: true,
  paidRef: true,
  page: { select: { paymentAccount: { select: ACCOUNT_SELECT } } },
} as const;

/**
 * `unknown`: nothing here could ask CHIP (the shop disconnected, its key will not open,
 * CHIP did not answer). The order page then offers the QR beside the wait, rather than
 * leave the customer waiting on an answer that may never come.
 */
export type PayStatus =
  | { state: 'paid'; paidAt: string | null; paidMethodLabel: string | null; paidRef: string | null }
  | { state: 'pending' | 'failed' | 'none' | 'unknown' };

/**
 * Where an order's online payment stands, for its order page. A placed order
 * with a purchase is checked with CHIP (with the owner's key) and settled the
 * way the callback settles it, so the page shows Paid even when the callback
 * is late, lost, or (in development) never sent.
 */
export async function payStatus(deps: PayOnlineDeps, token: string, now: Date): Promise<PayStatus> {
  const order = await deps.prisma.order.findUnique({ where: { tokenHash: hashSessionValue(token) }, select: ORDER_FOR_SETTLE });
  if (!order) throw new OrderNotFoundError();
  const paid = (row: { paidAt: Date | null; paidMethodLabel: string | null; paidRef: string | null }): PayStatus => ({
    state: 'paid',
    paidAt: row.paidAt?.toISOString() ?? null,
    paidMethodLabel: row.paidMethodLabel,
    paidRef: row.paidRef,
  });
  if (order.status === 'PAID' || order.status === 'COMPLETED') return paid(order);
  // A cancelled order whose payment may still land is checked, so it is recorded (a refund owed).
  const lateCheck = order.status === 'CANCELLED' && order.paidAt === null && order.chipPurchaseId !== null;
  if ((order.status !== 'PLACED' && !lateCheck) || !order.chipPurchaseId) return { state: 'none' };

  const clock = now.getTime();
  const recent = deps.lookups.recent(order.id, clock);
  if (recent) return recent;
  const status = await checkWithChip(deps, { ...order, chipPurchaseId: order.chipPurchaseId }, now);
  deps.lookups.keep(order.id, status, clock);
  return lateCheck ? { state: 'none' } : status;
}

async function checkWithChip(
  deps: PayOnlineDeps,
  order: { id: string; number: number; totalCents: number; chipPurchaseId: string; chipPurchaseDueAt: Date | null; pageId: string; page: { paymentAccount: ShopAccount | null } },
  now: Date,
): Promise<PayStatus> {
  const account = order.page.paymentAccount;
  // Disconnected while the customer paid: nothing here can ask CHIP, and nothing is guessed.
  if (!account) return { state: 'unknown' };
  const client = await openOwnerClient(deps, account, now);
  if (!client) return { state: 'unknown' };
  let purchase: ChipPurchase;
  try {
    purchase = await client.getPurchase(order.chipPurchaseId);
  } catch (error) {
    deps.log.warn({ orderId: order.id, err: errName(error) }, 'order purchase could not be checked');
    // A refused key is marked here too, so the owner's alert appears and checkout stops offering it.
    await noteRefusal(deps, account, error, now);
    return { state: 'unknown' };
  }
  const outcome = await settleChipPurchase(deps, order, purchase, now);
  deps.log.info({ orderId: order.id, purchaseId: purchase.id, outcome, source: 'order-page' }, 'order purchase checked');
  if (outcome === 'paid' || outcome === 'already-paid' || outcome === 'paid-after-cancel' || outcome === 'paid-twice') {
    const row = await deps.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paidAt: true, paidMethodLabel: true, paidRef: true } });
    return { state: 'paid', paidAt: row.paidAt?.toISOString() ?? null, paidMethodLabel: row.paidMethodLabel, paidRef: row.paidRef };
  }
  if (outcome === 'failed' || outcome === 'test-refused') return { state: 'failed' };
  // Past its due time (due_strict) a purchase can no longer be paid, whatever CHIP's status says yet;
  // never said of one CHIP says was paid, whatever became of it after.
  if (outcome === 'pending' && !wasPaid(purchase.status) && order.chipPurchaseDueAt && order.chipPurchaseDueAt.getTime() <= now.getTime()) return { state: 'failed' };
  return { state: 'pending' };
}

/**
 * Ruling on concern 3: before the owner cancels, or marks paid by hand, a placed order
 * that a customer may be paying online, CHIP's purchase is cancelled with the owner's
 * key. If CHIP will not cancel it because it was just paid (paid, cleared, settled, or
 * reversed since), the order is marked paid through CHIP and the move refused ("This
 * order was just paid online."). Anything else (CHIP down, the key gone) lets the move go
 * ahead: a payment that lands afterwards is recorded on the cancelled order (a refund
 * owed) or beside the hand-marked payment (paid twice).
 */
export async function cancelChipBeforeOwnerMove(deps: PayOnlineDeps, accountId: string, orderId: string, now: Date): Promise<void> {
  const order = await deps.prisma.order.findFirst({ where: { id: orderId, page: { accountId } }, select: ORDER_FOR_SETTLE });
  if (!order || order.status !== 'PLACED' || !order.chipPurchaseId) return;
  const account = order.page.paymentAccount;
  if (!account) return;
  const client = await openOwnerClient(deps, account, now);
  if (!client) return;
  try {
    await client.cancelPurchase(order.chipPurchaseId);
    return;
  } catch (error) {
    deps.log.warn({ orderId: order.id, purchaseId: order.chipPurchaseId, err: errName(error) }, 'order purchase could not be cancelled before the order');
  }
  const purchase = await client.getPurchase(order.chipPurchaseId).catch(() => null);
  if (!purchase || !wasPaid(purchase.status)) return;
  const outcome = await settleChipPurchase(deps, order, purchase, now);
  if (outcome === 'paid' || outcome === 'already-paid' || outcome === 'paid-twice') throw new OrderJustPaidError();
}

/** The callback's order: what verifying and settling it needs. */
export function orderForCallback(prisma: PrismaClient, orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: { ...ORDER_FOR_SETTLE, page: { select: { paymentAccount: { select: { ...ACCOUNT_SELECT, publicKeyPem: true } } } } },
  });
}

export { openOwnerClient };
