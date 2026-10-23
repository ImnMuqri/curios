import { randomBytes } from 'node:crypto';
import { canTakeOrders, hashSessionValue, MAIL_QUEUE, newOrderMail, normalizeMalaysianPhone, type MailJobData } from '@curios/core';
import { isOrderDay, ORDER_TOTAL_MAX_CENTS, orderCode, orderTotals } from '@curios/core/orders';
import type { Prisma, PrismaClient } from '@curios/db';
import { PageNotFoundError } from '../chat/chat.service.js';
import { PageUnavailableError } from '../pages/page-unavailable.js';
import { InvalidPhoneError } from '../leads/lead.service.js';
import { StoreBusinessOnlyError } from '../store/store.errors.js';
import {
  AddressRequiredError,
  ItemUnavailableError,
  MethodOffError,
  OrderDateError,
  OrdersPausedError,
  OrderTooLargeError,
  PricesChangedError,
  StoreClosedError,
  type ShelfItem,
} from './order.errors.js';

export interface OrderMailQueue {
  add(name: string, data: MailJobData, opts?: unknown): Promise<unknown>;
}

export interface PlaceDeps {
  prisma: PrismaClient;
  mailQueue: OrderMailQueue;
  log?: { warn?: (obj: object, msg: string) => void };
  /** Where the owner's order screen lives, for the email's button. */
  appUrl: string;
}

export interface PlaceInput {
  handle: string;
  lines: { itemId: string; optionId: string | null; quantity: number }[];
  method: 'PICKUP' | 'DELIVERY';
  /** A Malaysian calendar day, `YYYY-MM-DD`. */
  day: string;
  customerName: string;
  phone: string;
  address: string | null;
  note: string | null;
  /** The total the visitor was shown. Only compared, never stored. */
  seenTotalCents: number;
}

export interface Placed {
  number: number;
  code: string;
  token: string;
  totalCents: number;
}

/** getPublicShop's item select, so PRICES_CHANGED hands back what the shop renders. */
const SHELF_SELECT = {
  id: true,
  name: true,
  description: true,
  photoKey: true,
  priceCents: true,
  options: { orderBy: { position: 'asc' }, select: { id: true, label: true, priceCents: true } },
} as const;

/** Codes are 4 of 31 characters, so a page needs hundreds of thousands of orders before this many collide. */
const CODE_ATTEMPTS = 5;

const blankToNull = (value: string | null) => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/**
 * Places a visitor's order. Anonymous, so every check here is the only check,
 * and the client's total is only ever compared: the server prices every line
 * from the shelf as it stands under the lock.
 *
 * The page row is locked for the whole placement, as `grantPayment` locks it.
 * That is what makes the allowance and the order number safe: two visitors on
 * a page's last free order queue on the lock, and the second reads the count
 * the first wrote.
 */
export async function placeOrder(deps: PlaceDeps, input: PlaceInput, now: Date): Promise<Placed> {
  const phone = normalizeMalaysianPhone(input.phone);
  if (!phone) throw new InvalidPhoneError();
  const customerName = input.customerName.trim();
  const address = input.method === 'DELIVERY' ? blankToNull(input.address) : null;
  const note = blankToNull(input.note);

  // An early, unlocked read: the cheap refusals happen before a lock is taken.
  // Every one of them is checked again under the lock below, which is the
  // check that counts.
  const found = await deps.prisma.page.findUnique({
    where: { handle: input.handle.toLowerCase(), published: true },
    select: { id: true, mode: true, storeEnabled: true, minNoticeDays: true, closedDays: true, suspendedAt: true },
  });
  if (!found) throw new PageNotFoundError();
  if (found.suspendedAt !== null) throw new PageUnavailableError();
  if (found.mode !== 'BUSINESS') throw new StoreBusinessOnlyError();
  if (!found.storeEnabled) throw new StoreClosedError();
  if (!isOrderDay(input.day, { now, minNoticeDays: found.minNoticeDays, closedDays: found.closedDays })) {
    throw new OrderDateError();
  }

  const token = randomBytes(32).toString('base64url');

  const placed = await deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Page" WHERE "id" = ${found.id} FOR UPDATE`;
    const page = await tx.page.findUniqueOrThrow({
      where: { id: found.id },
      select: {
        published: true,
        suspendedAt: true,
        mode: true,
        storeEnabled: true,
        paidUntil: true,
        ordersPlaced: true,
        ordersAtTrialReset: true,
        pickupEnabled: true,
        deliveryMode: true,
        deliveryFeeCents: true,
        minNoticeDays: true,
        closedDays: true,
        notifyOrders: true,
        account: { select: { email: true } },
      },
    });
    if (!page.published) throw new PageNotFoundError();
    if (page.suspendedAt !== null) throw new PageUnavailableError();
    if (page.mode !== 'BUSINESS') throw new StoreBusinessOnlyError();
    if (!page.storeEnabled) throw new StoreClosedError();
    if (!canTakeOrders({ mode: page.mode, paidUntil: page.paidUntil, ordersPlaced: page.ordersPlaced, ordersAtTrialReset: page.ordersAtTrialReset, now })) {
      throw new OrdersPausedError();
    }

    const lines = await priceLines(tx, found.id, input.lines);

    if (input.method === 'PICKUP' ? !page.pickupEnabled : page.deliveryMode === 'NONE') {
      throw new MethodOffError(input.method);
    }
    if (!isOrderDay(input.day, { now, minNoticeDays: page.minNoticeDays, closedDays: page.closedDays })) {
      throw new OrderDateError();
    }
    if (input.method === 'DELIVERY' && address === null) throw new AddressRequiredError();

    const totals = orderTotals(lines, { method: input.method, mode: page.deliveryMode, feeCents: page.deliveryFeeCents });
    // Before anything else reads the total: past this it would not fit the Int columns it is stored in.
    if (totals.totalCents > ORDER_TOTAL_MAX_CENTS) throw new OrderTooLargeError();
    if (totals.totalCents !== input.seenTotalCents) {
      const shelf: ShelfItem[] = await tx.item.findMany({
        where: { pageId: found.id, available: true },
        orderBy: { position: 'asc' },
        select: SHELF_SELECT,
      });
      throw new PricesChangedError(shelf, { mode: page.deliveryMode, feeCents: page.deliveryFeeCents });
    }

    const number = page.ordersPlaced + 1;
    await tx.page.update({ where: { id: found.id }, data: { ordersPlaced: number } });

    // Checked rather than caught: a unique violation aborts a Postgres
    // transaction, so there is no retrying an insert inside one. Under the
    // page lock no other placement can write an order for this page, so a
    // code that is free here is still free at the insert.
    let code = orderCode();
    for (let attempt = 1; ; attempt++) {
      const taken = await tx.order.findUnique({ where: { pageId_code: { pageId: found.id, code } }, select: { id: true } });
      if (!taken) break;
      if (attempt >= CODE_ATTEMPTS) throw new Error(`No free order code for page ${found.id} after ${CODE_ATTEMPTS} tries`);
      code = orderCode();
    }

    const order = await tx.order.create({
      data: {
        pageId: found.id,
        number,
        code,
        tokenHash: hashSessionValue(token),
        customerName,
        phone,
        method: input.method,
        day: new Date(`${input.day}T00:00:00Z`),
        address,
        note,
        ...totals,
        lines: {
          create: lines.map((line, position) => ({
            itemId: line.itemId,
            itemName: line.itemName,
            optionLabel: line.optionLabel,
            unitPriceCents: line.unitCents,
            quantity: line.quantity,
            position,
          })),
        },
      },
      select: { id: true },
    });

    return { orderId: order.id, number, code, totals, lines, notify: page.notifyOrders, ownerEmail: page.account.email };
    // Above Prisma's 2s/5s defaults: a burst on one shop queues on the row
    // lock, one placement after another, and the last in line must not be
    // refused for waiting its turn.
  }, { maxWait: 10_000, timeout: 10_000 });

  // After the commit, never inside it: the order is placed whether or not the
  // email can be queued, and a queued email must never announce an order a
  // rollback took away.
  if (placed.notify) {
    const warn = (error: unknown) =>
      deps.log?.warn?.({ orderId: placed.orderId, err: error instanceof Error ? error.message : String(error) }, 'could not queue the new-order email');
    try {
      const mail = newOrderMail({
        number: placed.number,
        totalCents: placed.totals.totalCents,
        customerName,
        phone,
        method: input.method,
        deliveryCents: placed.totals.deliveryCents,
        day: input.day,
        note,
        lines: placed.lines.map((line) => ({
          itemName: line.itemName,
          optionLabel: line.optionLabel,
          quantity: line.quantity,
          lineCents: line.unitCents * line.quantity,
        })),
        url: `${deps.appUrl.replace(/\/+$/, '')}/app/orders?order=${placed.orderId}`,
        appUrl: deps.appUrl,
      });
      // Not awaited. The queue's connection retries without limit
      // (maxRetriesPerRequest: null), so during a Redis reconnect an awaited
      // add would hold the visitor's 201 open, and a visitor who gives up and
      // retries places the order twice. The order is already committed.
      void deps.mailQueue
        .add(MAIL_QUEUE, { to: placed.ownerEmail, ...mail }, { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true })
        .catch(warn);
    } catch (error) {
      warn(error);
    }
  }

  return { number: placed.number, code: placed.code, token, totalCents: placed.totals.totalCents };
}

interface PricedLine {
  itemId: string;
  itemName: string;
  optionLabel: string | null;
  unitCents: number;
  quantity: number;
}

/**
 * Each line priced from the shelf: an available item of this page, with one of
 * its own options when it has options and none when it has one price.
 * Anything else is refused, naming the item when it is this shop's.
 */
async function priceLines(tx: Prisma.TransactionClient, pageId: string, lines: PlaceInput['lines']): Promise<PricedLine[]> {
  const items = await tx.item.findMany({
    where: { pageId, id: { in: [...new Set(lines.map((line) => line.itemId))] } },
    select: { id: true, name: true, available: true, priceCents: true, options: { select: { id: true, label: true, priceCents: true } } },
  });
  const byId = new Map(items.map((item) => [item.id, item]));

  return lines.map((line) => {
    const item = byId.get(line.itemId);
    if (!item) throw new ItemUnavailableError(null);
    if (!item.available) throw new ItemUnavailableError(item.name);

    if (item.options.length > 0) {
      const option = item.options.find((o) => o.id === line.optionId);
      if (!option) throw new ItemUnavailableError(item.name);
      return { itemId: item.id, itemName: item.name, optionLabel: option.label, unitCents: option.priceCents, quantity: line.quantity };
    }
    if (line.optionId !== null || item.priceCents === null) throw new ItemUnavailableError(item.name);
    return { itemId: item.id, itemName: item.name, optionLabel: null, unitCents: item.priceCents, quantity: line.quantity };
  });
}
