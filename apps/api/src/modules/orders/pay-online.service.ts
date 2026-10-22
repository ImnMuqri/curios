import { ChipRefusedError, DEAD_PURCHASE_STATUSES, type ChipClient, type ChipPurchase, type PurchaseProduct } from '@curios/billing';
import { hashSessionValue } from '@curios/core';
import { openSecret } from '@curios/core/secret-box';
import { chipWhitelist, choiceLabel, onlineOffer, paidMethodLabel, payUrl, type OnlineChoice, type OnlineOffer } from '@curios/core/shop-pay';
import type { PrismaClient } from '@curios/db';
import { errName } from '../billing/billing.service.js';
import type { AvatarStore } from '../pages/storage.js';
import type { ChipClientFor } from '../store/chip.service.js';
import { OrderAlreadyPaidError, OrderCancelledError, OrderNotFoundError } from './order.errors.js';

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
  methods: MethodsCache;
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
    select: { mode: true, storeEnabled: true, paymentAccount: { select: ACCOUNT_SELECT } },
  });
  const account = page?.paymentAccount;
  if (!page || page.mode !== 'BUSINESS' || !page.storeEnabled || !account || !canTakePayment(deps, account)) return NOTHING_ONLINE;
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
  input: OnlineChoice & { email: string },
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
      chipPurchaseId: true,
      receiptKey: true,
      lines: { orderBy: { position: 'asc' }, select: { itemName: true, optionLabel: true, unitPriceCents: true, quantity: true } },
      page: { select: { handle: true, mode: true, paymentAccount: { select: ACCOUNT_SELECT } } },
    },
  });
  if (!order || order.page.mode !== 'BUSINESS') throw new OrderNotFoundError();
  refuseFor(order.status);
  const unavailable = (reason: string) => {
    deps.log.info({ orderId: order.id, reason }, 'online payment not available');
    return { url: null };
  };

  const account = order.page.paymentAccount;
  if (!account) return unavailable('not connected');
  if (!canTakePayment(deps, account)) return unavailable('account cannot take payment');
  const client = await openOwnerClient(deps, account, now);
  if (!client) return unavailable('key cannot be opened');

  // A purchase from an earlier attempt: if it was paid, that pays the order, and
  // a second purchase would charge the customer twice. Otherwise it is cancelled.
  if (order.chipPurchaseId) {
    const previous = await client.getPurchase(order.chipPurchaseId).catch(() => null);
    if (previous?.status === 'paid') {
      const outcome = await settleChipPurchase(deps, { ...order, pageId: account.pageId }, previous, now);
      if (outcome === 'paid' || outcome === 'already-paid') throw new OrderAlreadyPaidError();
    }
    if (!previous || !DEAD_PURCHASE_STATUSES.has(previous.status)) {
      await client.cancelPurchase(order.chipPurchaseId).catch((error: unknown) =>
        deps.log.warn({ orderId: order.id, purchaseId: order.chipPurchaseId, err: errName(error) }, 'earlier order purchase could not be cancelled'),
      );
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

  let purchase: ChipPurchase;
  try {
    purchase = await client.createPurchase({
      email: input.email,
      fullName: order.customerName,
      phone: chipPhone(order.phone),
      productName: `Order #${order.number}`,
      amountCents: order.totalCents,
      products,
      reference: String(order.number),
      notes: choiceLabel(input),
      ...(deps.callbackBaseUrl ? { successCallback: `${deps.callbackBaseUrl}/store/chip/callback/${order.id}` } : {}),
      redirectUrl: `${deps.appUrl}/${order.page.handle}/order/${token}`,
      dueAt: new Date(now.getTime() + PAY_WINDOW_MS),
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

  const { count } = await deps.prisma.order.updateMany({
    where: { id: order.id, status: 'PLACED' },
    data: { chipPurchaseId: purchase.id, payerEmail: input.email },
  });
  if (count === 0) {
    // Moved on while the purchase was made (the owner cancelled, or marked it paid).
    await client.cancelPurchase(purchase.id).catch(() => undefined);
    const now2 = await deps.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
    refuseFor(now2.status);
  }
  deps.log.info({ orderId: order.id, purchaseId: purchase.id }, 'order purchase created');

  const url = payUrl(purchase.checkoutUrl, input, methods);
  return { url };
}

export type SettleOutcome = 'paid' | 'already-paid' | 'pending' | 'failed' | 'mismatch' | 'test-refused' | 'not-placed';

/**
 * Applies what CHIP says about an order's purchase, fetched with the owner's
 * key: PLACED → PAID only when the purchase is the one this order holds, is
 * paid, carries this order's number as its reference and this order's total,
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
  if (purchase.reference !== String(order.number) || purchase.totalCents !== order.totalCents) {
    deps.log.warn({ orderId: order.id, purchaseId: purchase.id }, 'order purchase does not match its order');
    return 'mismatch';
  }
  if (deps.production && purchase.isTest) {
    deps.log.warn({ orderId: order.id, purchaseId: purchase.id }, 'test purchase refused in production');
    return 'test-refused';
  }
  if (purchase.status !== 'paid') return DEAD_PURCHASE_STATUSES.has(purchase.status) ? 'failed' : 'pending';

  // Read for the file only: the update clears the receipt fields whatever they hold.
  const before = await deps.prisma.order.findUnique({ where: { id: order.id }, select: { receiptKey: true } });
  const { count } = await deps.prisma.order.updateMany({
    where: { id: order.id, status: 'PLACED', chipPurchaseId: purchase.id },
    data: {
      status: 'PAID',
      paidAt: now,
      paidVia: 'CHIP',
      paidMethodLabel: paidMethodLabel(purchase),
      paidRef: purchase.referenceGenerated ?? purchase.id,
      // A receipt sent while paying online is not needed: CHIP's word is the proof.
      receiptKey: null,
      receiptType: null,
      receiptUploadedAt: null,
    },
  });
  if (count === 1) {
    // Task 14 sends the owner's "paid" email from here: this is the one moment
    // the order becomes PAID through CHIP, and it happens once.
    if (before?.receiptKey && deps.store) {
      await deps.store.remove(before.receiptKey).catch((error: unknown) =>
        deps.log.warn({ orderId: order.id, err: errName(error) }, 'receipt of an order paid online could not be removed'),
      );
    }
    return 'paid';
  }
  const after = await deps.prisma.order.findUnique({ where: { id: order.id }, select: { status: true } });
  if (after && (after.status === 'PAID' || after.status === 'COMPLETED')) return 'already-paid';
  // Paid at CHIP for an order that is no longer waiting (the owner cancelled it): the money is
  // in the owner's CHIP account and theirs to refund. Logged so it can be found.
  deps.log.warn({ orderId: order.id, purchaseId: purchase.id }, 'order paid online but no longer placed');
  return 'not-placed';
}

const ORDER_FOR_SETTLE = {
  id: true,
  number: true,
  status: true,
  totalCents: true,
  chipPurchaseId: true,
  pageId: true,
  paidAt: true,
  paidMethodLabel: true,
  paidRef: true,
  page: { select: { paymentAccount: { select: ACCOUNT_SELECT } } },
} as const;

export type PayStatus =
  | { state: 'paid'; paidAt: string | null; paidMethodLabel: string | null; paidRef: string | null }
  | { state: 'pending' | 'failed' | 'none' };

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
  if (order.status !== 'PLACED' || !order.chipPurchaseId) return { state: 'none' };

  const account = order.page.paymentAccount;
  // Disconnected while the customer paid: nothing here can ask CHIP, and nothing is guessed.
  if (!account) return { state: 'pending' };
  const client = await openOwnerClient(deps, account, now);
  if (!client) return { state: 'pending' };
  let purchase: ChipPurchase;
  try {
    purchase = await client.getPurchase(order.chipPurchaseId);
  } catch (error) {
    deps.log.warn({ orderId: order.id, err: errName(error) }, 'order purchase could not be checked');
    return { state: 'pending' };
  }
  const outcome = await settleChipPurchase(deps, order, purchase, now);
  deps.log.info({ orderId: order.id, purchaseId: purchase.id, outcome, source: 'order-page' }, 'order purchase checked');
  if (outcome === 'paid' || outcome === 'already-paid') {
    return paid(await deps.prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paidAt: true, paidMethodLabel: true, paidRef: true } }));
  }
  return { state: outcome === 'failed' || outcome === 'test-refused' ? 'failed' : 'pending' };
}

/** The callback's order: what verifying and settling it needs. */
export function orderForCallback(prisma: PrismaClient, orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: { ...ORDER_FOR_SETTLE, page: { select: { paymentAccount: { select: { ...ACCOUNT_SELECT, publicKeyPem: true } } } } },
  });
}

export { openOwnerClient };
