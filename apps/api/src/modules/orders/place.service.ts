import { randomBytes } from 'node:crypto';
import { canTakeOrders, hashSessionValue, MAIL_QUEUE, newOrderMail, normalizeMalaysianPhone, type MailJobData } from '@curios/core';
import { digitalFacts, isDigitalOnly, seatsLeft } from '@curios/core/digital';
import { sealSecret } from '@curios/core/secret-box';
import { isOrderDay, ORDER_TOTAL_MAX_CENTS, orderCode, orderTotals } from '@curios/core/orders';
import type { Prisma, PrismaClient } from '@curios/db';
import type { Settings } from '@curios/core/settings';
import { PageNotFoundError } from '../chat/chat.service.js';
import { PageUnavailableError } from '../pages/page-unavailable.js';
import { InvalidPhoneError } from '../leads/lead.service.js';
import { StoreBusinessOnlyError } from '../store/store.errors.js';
import {
  AddressRequiredError,
  EmailRequiredError,
  ItemUnavailableError,
  MethodOffError,
  OrderDateError,
  OrdersPausedError,
  OrderShapeError,
  OrderTooLargeError,
  PricesChangedError,
  SoldOutError,
  StoreClosedError,
  TimeFullError,
  TimeRequiredError,
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
  /** PAYMENT_SECRETS_KEY: seals the order token so later emails can carry the order link. Null leaves it unsealed. */
  secretsKey?: Buffer | null;
  /** The admin's settings, read per request: the free trial is `settings.freeOrders` orders long. */
  settings: Settings;
}

export interface PlaceInput {
  handle: string;
  /** `sessionId` is the class time picked, for a SESSION item's line; absent on every other. */
  lines: { itemId: string; optionId: string | null; quantity: number; sessionId?: string | null }[];
  /** Absent for a digital-only basket, present (with `day`) as soon as it holds a physical item. */
  method?: 'PICKUP' | 'DELIVERY' | null;
  /** A Malaysian calendar day, `YYYY-MM-DD`; absent as `method` is. */
  day?: string | null;
  /** Where digital items are sent: required when any line is digital. */
  email?: string | null;
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
  kind: true,
  delivery: true,
  accessUrl: true,
  sessionMinutes: true,
  sessionPlace: true,
  files: { orderBy: { position: 'asc' }, select: { name: true, contentType: true } },
  sessions: { select: { id: true, startsAt: true, seats: true, bookings: { select: { seats: true } } } },
  _count: { select: { codes: { where: { orderLineId: null } } } },
} as const;

/** Enough to catch a typo; the mail server says the rest. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const email = blankToNull(input.email ?? null);
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
  // A day is only asked about when one came (a digital-only basket sends none); a missing one is judged under the lock, once the basket says whether it needs one.
  if (input.day && !isOrderDay(input.day, { now, minNoticeDays: found.minNoticeDays, closedDays: found.closedDays })) {
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
    if (!canTakeOrders({ mode: page.mode, paidUntil: page.paidUntil, ordersPlaced: page.ordersPlaced, ordersAtTrialReset: page.ordersAtTrialReset, now }, deps.settings.freeOrders)) {
      throw new OrdersPausedError();
    }

    const lines = await priceLines(tx, found.id, input.lines);

    // Digital-only: nothing to pick up or send, so no method, no day and no fee. Anything physical keeps all three.
    const digitalOnly = isDigitalOnly(lines);
    const anyDigital = lines.some((line) => line.kind === 'DIGITAL');
    const method = digitalOnly ? null : (input.method ?? null);
    const day = digitalOnly ? null : (input.day ?? null);
    if (digitalOnly && (input.method || input.day)) {
      throw new OrderShapeError('A digital order has no pickup, delivery or day. Remove them and try again.');
    }
    if (!digitalOnly) {
      if (method === null) throw new OrderShapeError('Pick pickup or delivery.');
      if (day === null) throw new OrderDateError();
      if (method === 'PICKUP' ? !page.pickupEnabled : page.deliveryMode === 'NONE') throw new MethodOffError(method);
      if (!isOrderDay(day, { now, minNoticeDays: page.minNoticeDays, closedDays: page.closedDays })) throw new OrderDateError();
      if (method === 'DELIVERY' && address === null) throw new AddressRequiredError();
    }
    if (anyDigital && (email === null || email.length > 254 || !EMAIL.test(email))) throw new EmailRequiredError();

    const totals = orderTotals(lines, { method: method ?? 'PICKUP', mode: page.deliveryMode, feeCents: page.deliveryFeeCents });
    // Before anything else reads the total: past this it would not fit the Int columns it is stored in.
    if (totals.totalCents > ORDER_TOTAL_MAX_CENTS) throw new OrderTooLargeError();
    if (totals.totalCents !== input.seenTotalCents) {
      const rows = await tx.item.findMany({
        where: { pageId: found.id, available: true },
        orderBy: { position: 'asc' },
        select: SHELF_SELECT,
      });
      const shelf: ShelfItem[] = rows.map(({ files, sessions, _count, accessUrl, sessionMinutes, sessionPlace, kind, delivery, ...item }) => ({
        ...item,
        ...digitalFacts(
          {
            kind,
            delivery,
            accessUrl,
            sessionMinutes,
            sessionPlace,
            files,
            codesLeft: _count.codes,
            sessions: sessions.map((t) => ({ id: t.id, startsAt: t.startsAt, seats: t.seats, booked: t.bookings.reduce((n, b) => n + b.seats, 0) })),
          },
          now,
        ),
      }));
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
        tokenSealed: deps.secretsKey ? sealSecret(token, deps.secretsKey) : null,
        customerName,
        phone,
        method,
        day: day === null ? null : new Date(`${day}T00:00:00Z`),
        email: anyDigital ? email : null,
        address,
        note,
        itemsCents: totals.itemsCents,
        deliveryCents: totals.deliveryCents,
        totalCents: totals.totalCents,
        lines: {
          create: lines.map((line, position) => ({
            itemId: line.itemId,
            itemName: line.itemName,
            optionLabel: line.optionLabel,
            unitPriceCents: line.unitCents,
            quantity: line.quantity,
            position,
            // What was sold, as it stood: later steps read the line, never the live item.
            kind: line.kind,
            delivery: line.delivery,
            accessUrl: line.accessUrl,
            accessNote: line.accessNote,
            sessionMinutes: line.sessionMinutes,
            sessionPlace: line.sessionPlace,
            sessionWhere: line.sessionWhere,
          })),
        },
      },
      select: { id: true, lines: { orderBy: { position: 'asc' }, select: { id: true } } },
    });

    // Last, so a refusal costs nothing: codes and seats are taken under their own locks, and a throw rolls the order back with them.
    await reserveStock(tx, lines, order.lines.map((l) => l.id), now);

    return { orderId: order.id, number, code, totals, lines, method, day, notify: page.notifyOrders, ownerEmail: page.account.email };
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
        method: placed.method,
        deliveryCents: placed.totals.deliveryCents,
        day: placed.day,
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
        .add(MAIL_QUEUE, { to: placed.ownerEmail, ...mail, audience: 'owner' }, { attempts: 5, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true })
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
  kind: 'PHYSICAL' | 'DIGITAL';
  delivery: 'FILES' | 'LINK' | 'CODES' | 'SESSION' | null;
  accessUrl: string | null;
  accessNote: string | null;
  sessionMinutes: number | null;
  sessionPlace: 'ONLINE' | 'IN_PERSON' | null;
  sessionWhere: string | null;
  /** The class time picked, for a SESSION line. */
  sessionId: string | null;
}

/**
 * Each line priced from the shelf: an available item of this page, with one of
 * its own options when it has options and none when it has one price.
 * Anything else is refused, naming the item when it is this shop's. A digital
 * item with nothing to give (no file, no link) is refused as sold out here;
 * codes and seats are counted under their locks, in reserveStock.
 */
async function priceLines(tx: Prisma.TransactionClient, pageId: string, lines: PlaceInput['lines']): Promise<PricedLine[]> {
  const items = await tx.item.findMany({
    where: { pageId, id: { in: [...new Set(lines.map((line) => line.itemId))] } },
    select: {
      id: true,
      name: true,
      available: true,
      priceCents: true,
      options: { select: { id: true, label: true, priceCents: true } },
      kind: true,
      delivery: true,
      accessUrl: true,
      accessNote: true,
      sessionMinutes: true,
      sessionPlace: true,
      sessionWhere: true,
      _count: { select: { files: true } },
    },
  });
  const byId = new Map(items.map((item) => [item.id, item]));

  return lines.map((line) => {
    const item = byId.get(line.itemId);
    if (!item) throw new ItemUnavailableError(null);
    if (!item.available) throw new ItemUnavailableError(item.name);

    let optionLabel: string | null = null;
    let unitCents: number;
    if (item.options.length > 0) {
      const option = item.options.find((o) => o.id === line.optionId);
      if (!option) throw new ItemUnavailableError(item.name);
      optionLabel = option.label;
      unitCents = option.priceCents;
    } else {
      if (line.optionId !== null || item.priceCents === null) throw new ItemUnavailableError(item.name);
      unitCents = item.priceCents;
    }

    const digital = item.kind === 'DIGITAL';
    const sessionId = line.sessionId ?? null;
    if (digital) {
      if (item.delivery === null) throw new SoldOutError(item.name);
      if (item.delivery === 'FILES' && item._count.files === 0) throw new SoldOutError(item.name);
      if (item.delivery === 'LINK' && !item.accessUrl) throw new SoldOutError(item.name);
      if (item.delivery === 'SESSION' && sessionId === null) throw new TimeRequiredError(item.name);
    }
    if (sessionId !== null && !(digital && item.delivery === 'SESSION')) throw new ItemUnavailableError(item.name);

    return {
      itemId: item.id,
      itemName: item.name,
      optionLabel,
      unitCents,
      quantity: line.quantity,
      kind: item.kind,
      delivery: digital ? item.delivery : null,
      accessUrl: digital && item.delivery === 'LINK' ? item.accessUrl : null,
      accessNote: digital && item.delivery === 'LINK' ? item.accessNote : null,
      sessionMinutes: digital && item.delivery === 'SESSION' ? item.sessionMinutes : null,
      sessionPlace: digital && item.delivery === 'SESSION' ? item.sessionPlace : null,
      sessionWhere: digital && item.delivery === 'SESSION' ? item.sessionWhere : null,
      sessionId,
    };
  });
}

/**
 * Takes what the digital lines are for, under their own locks and inside the
 * placement's transaction: `quantity` unused codes per CODES line (rows locked
 * with SKIP LOCKED, and never the same code twice in one order), and a booking
 * of `quantity` seats at the picked time per SESSION line (the time's row
 * locked FOR UPDATE, the lock the owner's time edits take). Short of either,
 * the whole order is refused and rolled back with them.
 */
async function reserveStock(tx: Prisma.TransactionClient, lines: PricedLine[], lineIds: string[], now: Date): Promise<void> {
  const taken: string[] = [];
  for (const [index, line] of lines.entries()) {
    const lineId = lineIds[index];
    if (!lineId) throw new Error('an order line was not created');
    if (line.delivery === 'CODES') {
      const free = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "ItemCode"
        WHERE "itemId" = ${line.itemId} AND "orderLineId" IS NULL AND "id" <> ALL(${taken}::text[])
        ORDER BY "createdAt", "id"
        LIMIT ${line.quantity}
        FOR UPDATE SKIP LOCKED`;
      if (free.length < line.quantity) throw new SoldOutError(line.itemName);
      const ids = free.map((row) => row.id);
      await tx.itemCode.updateMany({ where: { id: { in: ids } }, data: { orderLineId: lineId } });
      taken.push(...ids);
    } else if (line.delivery === 'SESSION' && line.sessionId) {
      const [time] = await tx.$queryRaw<{ itemId: string; startsAt: Date; seats: number }[]>`
        SELECT "itemId", "startsAt", "seats" FROM "ItemSession" WHERE "id" = ${line.sessionId} FOR UPDATE`;
      // Another item's time, a deleted one and a past one all read the same: not bookable.
      if (!time || time.itemId !== line.itemId || time.startsAt.getTime() <= now.getTime()) throw new TimeFullError(line.itemName);
      const booked = await tx.sessionBooking.aggregate({ where: { sessionId: line.sessionId }, _sum: { seats: true } });
      if (seatsLeft(time, booked._sum.seats ?? 0) < line.quantity) throw new TimeFullError(line.itemName);
      await tx.sessionBooking.create({ data: { sessionId: line.sessionId, orderLineId: lineId, seats: line.quantity } });
    }
  }
}
