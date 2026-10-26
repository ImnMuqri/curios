import { canTakeOrders, hashSessionValue } from '@curios/core';
import { DOWNLOAD_USES, seatsLeft } from '@curios/core/digital';
import { malaysiaToday } from '@curios/core/orders';
import type { HeadingFont, PageBackground, PageStyle } from '@curios/core/bento';
import type { DeliveryMode } from '@curios/core/store';
import type { Prisma } from '@prisma/client';
import { prismaRead } from './client.js';
import { getPublicShop, type PublicItem, type PublicShop } from './shop.query.js';

type OrderStatus = 'PLACED' | 'PAID' | 'COMPLETED' | 'CANCELLED';
type OrderMethod = 'PICKUP' | 'DELIVERY';

export interface OwnerOrder {
  id: string;
  number: number;
  code: string;
  customerName: string;
  phone: string;
  /** Null for a digital-only order. */
  method: OrderMethod | null;
  /** The calendar day (Malaysia), `YYYY-MM-DD`; null for a digital-only order. */
  day: string | null;
  address: string | null;
  note: string | null;
  itemsCents: number;
  deliveryCents: number;
  totalCents: number;
  status: OrderStatus;
  /** The storage key; the web layer joins it onto STORAGE_PUBLIC_URL, as avatars are. */
  receiptKey: string | null;
  receiptType: string | null;
  receiptUploadedAt: Date | null;
  receiptRejectedAt: Date | null;
  paidAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  refundedAt: Date | null;
  /** How it was paid, and for CHIP how and by what reference ("FPX · Maybank2u"): Orders says so. */
  paidVia: 'RECEIPT' | 'MANUAL' | 'CHIP' | null;
  paidMethodLabel: string | null;
  paidRef: string | null;
  /** When CHIP took a payment on top of one made another way (QR, by hand): one is owed back. */
  chipPaidTwiceAt: Date | null;
  /** When the owner marked that second payment refunded (apart from a cancelled order's refundedAt). */
  secondRefundedAt: Date | null;
  createdAt: Date;
  /** Where the digital items go; null on an order with none. */
  email: string | null;
  /** When the digital items were delivered; null until then. */
  sentAt: Date | null;
  lines: { id: string; itemName: string; optionLabel: string | null; unitPriceCents: number; quantity: number; photoKey: string | null; digital: OwnerDigitalLine | null }[];
}

/** What the "Sent by email" card says of one digital line; null on a physical one. */
export interface OwnerDigitalLine {
  delivery: 'FILES' | 'LINK' | 'CODES' | 'SESSION' | null;
  /** FILES: per file, the downloads spent across all its grants and what the newest grant has left. */
  files: { name: string; used: number; left: number; expiresAt: Date }[];
  /** LINK: when the buyer first opened it. */
  linkOpenedAt: Date | null;
  /** CODES: the codes this line was given. */
  codes: string[];
  /** CODES: unused codes the item still has; null when the item is gone. */
  codesLeft: number | null;
  /** SESSION: the booked time and seats. */
  session: { startsAt: Date; seats: number; remindedAt: Date | null } | null;
  /** SESSION: the item's other future times with room for this booking, for Move time. */
  times: { id: string; startsAt: Date; seatsLeft: number }[];
}

const dayText = (day: Date | null): string | null => (day ? day.toISOString().slice(0, 10) : null);

/**
 * A digital-only order that has been sent: it is paid and there is nothing to
 * make or complete, so it is done as far as the owner's to-do goes.
 */
const DIGITAL_SENT = { sentAt: { not: null }, lines: { none: { kind: 'PHYSICAL' as const } } };

/**
 * What still needs the owner: a receipt to check or a payment to wait for
 * (PLACED), something to make (PAID, unless it only sold digital items and was sent), money to send back (CANCELLED after it
 * was paid, not yet refunded). The same rules as the figures and the nav
 * badge, so nothing they count can fall off the list.
 */
const NEEDS_OWNER = {
  OR: [{ status: 'PLACED' as const }, { status: 'PAID' as const, NOT: DIGITAL_SENT }, { status: 'CANCELLED' as const, paidAt: { not: null }, refundedAt: null }, { chipPaidTwiceAt: { not: null }, secondRefundedAt: null }],
};

const newestFirst = (a: { createdAt: Date; number: number }, b: { createdAt: Date; number: number }) =>
  b.createdAt.getTime() - a.createdAt.getTime() || b.number - a.number;

/**
 * This owner's orders, newest first, scoped through the page's owner inside
 * the query: an order carries a name, a phone and an address.
 *
 * Every order that still needs the owner, however old, and the newest
 * `limit` (at most 100) of the rest. Capping the whole list would drop an old
 * receipt to check off the screen while the figures and the badge still
 * count it.
 */
export async function getOwnerOrders(accountId: string, options: { limit?: number; now?: Date } = {}): Promise<OwnerOrder[]> {
  const scope = { page: { accountId } };
  const [open, done] = await Promise.all([
    readOwnerOrders({ AND: [scope, NEEDS_OWNER] }, undefined, options.now),
    readOwnerOrders({ AND: [scope, { NOT: NEEDS_OWNER }] }, Math.min(options.limit ?? 50, 100), options.now),
  ]);
  // The two halves cannot overlap (one is the other's NOT); merged back into one newest-first list.
  return [...open, ...done].sort(newestFirst);
}

async function readOwnerOrders(where: Prisma.OrderWhereInput, take?: number, now = new Date()): Promise<OwnerOrder[]> {
  const rows = await prismaRead.order.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
    ...(take === undefined ? {} : { take }),
    select: {
      id: true,
      number: true,
      code: true,
      customerName: true,
      phone: true,
      method: true,
      day: true,
      address: true,
      note: true,
      itemsCents: true,
      deliveryCents: true,
      totalCents: true,
      status: true,
      receiptKey: true,
      receiptType: true,
      receiptUploadedAt: true,
      receiptRejectedAt: true,
      paidAt: true,
      completedAt: true,
      cancelledAt: true,
      refundedAt: true,
      paidVia: true,
      paidMethodLabel: true,
      paidRef: true,
      chipPaidTwiceAt: true,
      secondRefundedAt: true,
      createdAt: true,
      email: true,
      sentAt: true,
      lines: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          itemId: true,
          itemName: true,
          optionLabel: true,
          unitPriceCents: true,
          quantity: true,
          kind: true,
          delivery: true,
          linkOpenedAt: true,
          item: { select: { photoKey: true } },
          booking: { select: { seats: true, remindedAt: true, session: { select: { id: true, startsAt: true } } } },
          codes: { where: { givenAt: { not: null } }, orderBy: { givenAt: 'asc' }, select: { code: true } },
          grants: { orderBy: { createdAt: 'desc' }, select: { fileId: true, fileName: true, usesLeft: true, expiresAt: true } },
        },
      },
    },
  });

  // What Move time and the codes line need, for every digital line at once: two reads, never one per line.
  const lineRows = rows.flatMap((row) => row.lines);
  const codeItems = [...new Set(lineRows.filter((l) => l.delivery === 'CODES' && l.itemId).map((l) => l.itemId!))];
  const timeItems = [...new Set(lineRows.filter((l) => l.delivery === 'SESSION' && l.itemId).map((l) => l.itemId!))];
  const [stock, sessions] = await Promise.all([
    codeItems.length
      ? prismaRead.itemCode.groupBy({ by: ['itemId'], where: { itemId: { in: codeItems }, orderLineId: null }, _count: { _all: true } })
      : [],
    timeItems.length
      ? prismaRead.itemSession.findMany({
          where: { itemId: { in: timeItems }, startsAt: { gt: now } },
          orderBy: { startsAt: 'asc' },
          select: { id: true, itemId: true, startsAt: true, seats: true, bookings: { select: { seats: true } } },
        })
      : [],
  ]);
  const codesLeft = new Map(stock.map((g) => [g.itemId, g._count._all]));

  return rows.map(({ day, lines, ...order }) => ({
    ...order,
    day: dayText(day),
    lines: lines.map(({ item, itemId, kind, delivery, linkOpenedAt, booking, codes, grants, ...line }) => {
      // The newest grant per file is what the buyer holds now; the uses spent are summed over every grant the file ever had.
      const files = new Map<string, { name: string; used: number; left: number; expiresAt: Date }>();
      for (const g of grants) {
        const key = g.fileId ?? g.fileName;
        const spent = DOWNLOAD_USES - g.usesLeft;
        const seen = files.get(key);
        if (seen) seen.used += spent;
        else files.set(key, { name: g.fileName, used: spent, left: g.usesLeft, expiresAt: g.expiresAt });
      }
      return {
        ...line,
        photoKey: item?.photoKey ?? null,
        digital:
          kind === 'DIGITAL'
            ? {
                delivery,
                files: [...files.values()],
                linkOpenedAt,
                codes: codes.map((c) => c.code),
                codesLeft: itemId ? (codesLeft.get(itemId) ?? 0) : null,
                session: booking ? { startsAt: booking.session.startsAt, seats: booking.seats, remindedAt: booking.remindedAt } : null,
                times:
                  delivery === 'SESSION' && booking
                    ? sessions
                        .filter((s) => s.itemId === itemId && s.id !== booking.session.id)
                        .map((s) => ({ id: s.id, startsAt: s.startsAt, seatsLeft: seatsLeft(s, s.bookings.reduce((n, b) => n + b.seats, 0)) }))
                        .filter((t) => t.seatsLeft >= booking.seats)
                    : [],
              }
            : null,
      };
    }),
  }));
}

export interface OrderStats {
  /** PLACED with a receipt in: waiting for the owner to look. */
  toCheck: number;
  /** PAID: to be made. */
  toMake: number;
  /** Paid sen over the last 7 Malaysian days, today included. */
  paidThisWeekCents: number;
}

const DAY_MS = 86_400_000;
/** Malaysia is UTC+8 all year. */
const MALAYSIA_OFFSET_MS = 8 * 3_600_000;

/** The board's three figures. An order counts on the Malaysian day of its `paidAt`; a cancelled one not at all. */
export async function getOrderStats(accountId: string, now = new Date()): Promise<OrderStats> {
  const scope = { page: { accountId } };
  const today = Date.parse(`${malaysiaToday(now)}T00:00:00Z`);
  const first = today - 6 * DAY_MS;
  const [toCheck, toMake, paid] = await Promise.all([
    prismaRead.order.count({ where: { ...scope, status: 'PLACED', receiptUploadedAt: { not: null } } }),
    prismaRead.order.count({ where: { ...scope, status: 'PAID', NOT: DIGITAL_SENT } }),
    prismaRead.order.findMany({
      where: {
        ...scope,
        status: { in: ['PAID', 'COMPLETED'] },
        paidAt: { gte: new Date(first - MALAYSIA_OFFSET_MS), lt: new Date(today + DAY_MS - MALAYSIA_OFFSET_MS) },
      },
      select: { totalCents: true, paidAt: true },
    }),
  ]);
  let paidThisWeekCents = 0;
  for (const order of paid) {
    if (!order.paidAt) continue;
    const slot = Math.floor((order.paidAt.getTime() + MALAYSIA_OFFSET_MS - first) / DAY_MS);
    if (slot >= 0 && slot < 7) paidThisWeekCents += order.totalCents;
  }
  return { toCheck, toMake, paidThisWeekCents };
}

/** A grant to download one file of a FILES line (the newest per file; older ones are only made obsolete by new links). */
export interface PublicGrant {
  id: string;
  fileName: string;
  sizeBytes: number | null;
  usesLeft: number;
  expiresAt: Date;
}

/**
 * One line of the customer's order, all from what was sold (the line's snapshots).
 * What the buyer is only given once paid (codes, the meeting place, the downloads)
 * comes back empty until the order is PAID or COMPLETED.
 */
export interface PublicOrderLine {
  id: string;
  itemName: string;
  optionLabel: string | null;
  unitPriceCents: number;
  quantity: number;
  photoKey: string | null;
  kind: 'PHYSICAL' | 'DIGITAL';
  delivery: 'FILES' | 'LINK' | 'CODES' | 'SESSION' | null;
  /** The owner's note for a LINK line (the URL itself never leaves: the API's link route opens it). */
  accessNote: string | null;
  /** Whether a LINK line has a link to open. */
  hasLink: boolean;
  sessionMinutes: number | null;
  sessionPlace: 'ONLINE' | 'IN_PERSON' | null;
  /** The meeting URL or the place; null before payment. */
  sessionWhere: string | null;
  /** The booked time of a SESSION line. */
  sessionStartsAt: Date | null;
  /** The codes this line was given, after payment. */
  codes: string[];
  grants: PublicGrant[];
}

export interface PublicOrder {
  id: string;
  number: number;
  code: string;
  customerName: string;
  phone: string;
  method: OrderMethod | null;
  day: string | null;
  address: string | null;
  note: string | null;
  itemsCents: number;
  deliveryCents: number;
  totalCents: number;
  status: OrderStatus;
  receiptKey: string | null;
  receiptType: string | null;
  receiptUploadedAt: Date | null;
  receiptRejectedAt: Date | null;
  paidAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  refundedAt: Date | null;
  /** How it was paid; null until it is. */
  paidVia: 'RECEIPT' | 'MANUAL' | 'CHIP' | null;
  /** How CHIP says it was paid ("FPX · Maybank2u") and CHIP's reference, for the Paid row. */
  paidMethodLabel: string | null;
  paidRef: string | null;
  /** Placed, with a CHIP purchase started for it: the order page checks it. The purchase id itself stays on the server. */
  chipPending: boolean;
  /** Where the digital items were sent; null on an order with none. */
  email: string | null;
  /** When the digital items were delivered; null until then. */
  sentAt: Date | null;
  createdAt: Date;
  lines: PublicOrderLine[];
  page: {
    handle: string;
    displayName: string;
    language: string;
    style: PageStyle;
    accentColor: string;
    headingFont: HeadingFont;
    avatarKey: string | null;
    coverKey: string | null;
    background: PageBackground;
    backgroundColor: string | null;
    /** The page's links, for `whatsappNumber(links)` to find the owner's WhatsApp. */
    links: { label: string; url: string }[];
    paymentQrKey: string | null;
    bankName: string | null;
    bankAccountName: string | null;
    bankAccountNumber: string | null;
    /** What the shop's CHIP account takes, for the order page's "Try paying again"; null when nothing (as getCheckout's). */
    chipMethods: string[] | null;
    /** The Curios team has suspended the page: the order is readable, but how to pay it is withheld (QR, bank and CHIP come back empty). */
    suspended: boolean;
  };
}

/** The methods a shop's CHIP account takes, or null: none connected, its key refused, or a test key in production. */
function usableChipMethods(chip: { methods: string[]; isTest: boolean; lastErrorAt: Date | null } | null): string[] | null {
  return chip && chip.lastErrorAt === null && !(chip.isTest && process.env.NODE_ENV === 'production') ? chip.methods : null;
}

/**
 * The order page's data, found by the link's secret. Only its hash is stored,
 * so the lookup hashes what it is given. Null for an unknown token.
 */
export async function getOrderByToken(token: string): Promise<PublicOrder | null> {
  const row = await prismaRead.order.findUnique({
    where: { tokenHash: hashSessionValue(token) },
    select: {
      id: true,
      number: true,
      code: true,
      customerName: true,
      phone: true,
      method: true,
      day: true,
      address: true,
      note: true,
      itemsCents: true,
      deliveryCents: true,
      totalCents: true,
      status: true,
      receiptKey: true,
      receiptType: true,
      receiptUploadedAt: true,
      receiptRejectedAt: true,
      paidAt: true,
      completedAt: true,
      cancelledAt: true,
      refundedAt: true,
      paidVia: true,
      paidMethodLabel: true,
      paidRef: true,
      chipPurchaseId: true,
      email: true,
      sentAt: true,
      createdAt: true,
      lines: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          itemName: true,
          optionLabel: true,
          unitPriceCents: true,
          quantity: true,
          kind: true,
          delivery: true,
          accessUrl: true,
          accessNote: true,
          sessionMinutes: true,
          sessionPlace: true,
          sessionWhere: true,
          item: { select: { photoKey: true } },
          booking: { select: { session: { select: { startsAt: true } } } },
          codes: { where: { givenAt: { not: null } }, orderBy: { givenAt: 'asc' }, select: { code: true } },
          grants: {
            orderBy: { createdAt: 'desc' },
            select: { id: true, fileId: true, fileName: true, usesLeft: true, expiresAt: true, file: { select: { sizeBytes: true } } },
          },
        },
      },
      page: {
        select: {
          handle: true,
          displayName: true,
          language: true,
          suspendedAt: true,
          style: true,
          accentColor: true,
          headingFont: true,
          avatarKey: true,
          coverKey: true,
          background: true,
          backgroundColor: true,
          links: { orderBy: { position: 'asc' }, select: { label: true, url: true } },
          paymentQrKey: true,
          bankName: true,
          bankAccountName: true,
          bankAccountNumber: true,
          // Never the sealed key: the read-only role cannot read that column at all.
          paymentAccount: { select: { methods: true, isTest: true, lastErrorAt: true } },
        },
      },
    },
  });
  if (!row) return null;
  const {
    day,
    lines,
    chipPurchaseId,
    page: { paymentAccount, suspendedAt, ...page },
    ...order
  } = row;
  return {
    ...order,
    // A suspended page's order stays readable, but nothing says how to pay it: no QR, no bank, no CHIP.
    page:
      suspendedAt === null
        ? { ...page, suspended: false, chipMethods: usableChipMethods(paymentAccount) }
        : { ...page, suspended: true, paymentQrKey: null, bankName: null, bankAccountName: null, bankAccountNumber: null, chipMethods: null },
    chipPending: order.status === 'PLACED' && chipPurchaseId !== null,
    day: dayText(day),
    lines: lines.map((line) => publicLine(line, order.status === 'PAID' || order.status === 'COMPLETED')),
  };
}

type LineRow = Prisma.OrderLineGetPayload<{
  select: {
    id: true;
    itemName: true;
    optionLabel: true;
    unitPriceCents: true;
    quantity: true;
    kind: true;
    delivery: true;
    accessUrl: true;
    accessNote: true;
    sessionMinutes: true;
    sessionPlace: true;
    sessionWhere: true;
    item: { select: { photoKey: true } };
    booking: { select: { session: { select: { startsAt: true } } } };
    codes: { select: { code: true } };
    grants: { select: { id: true; fileId: true; fileName: true; usesLeft: true; expiresAt: true; file: { select: { sizeBytes: true } } } };
  };
}>;

/** What the customer may see of a line; the gifts (codes, place, downloads) only once paid. */
function publicLine(line: LineRow, paid: boolean): PublicOrderLine {
  const { item, booking, codes, grants, accessUrl, sessionWhere, ...rest } = line;
  // The newest grant per file (the rows come newest first); an older one is what "new links" left to expire.
  const seen = new Set<string>();
  const newest = grants.filter((g) => {
    const key = g.fileId ?? g.fileName;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    ...rest,
    photoKey: item?.photoKey ?? null,
    // The owner's note may hold a password: like the codes, only once paid.
    accessNote: paid ? rest.accessNote : null,
    hasLink: accessUrl !== null,
    sessionWhere: paid ? sessionWhere : null,
    sessionStartsAt: booking?.session.startsAt ?? null,
    codes: paid ? codes.map((c) => c.code) : [],
    grants: paid ? newest.map((g) => ({ id: g.id, fileName: g.fileName, sizeBytes: g.file?.sizeBytes ?? null, usesLeft: g.usesLeft, expiresAt: g.expiresAt })) : [],
  };
}

export interface Checkout extends PublicShop {
  pickupEnabled: boolean;
  pickupNote: string | null;
  deliveryMode: DeliveryMode;
  deliveryFeeCents: number | null;
  deliveryNote: string | null;
  minNoticeDays: number;
  closedDays: number[];
  /** `canTakeOrders` of @curios/core, the one rule the shop, API, Alerts and Billing share. */
  canTakeOrders: boolean;
  /** The owner's QR or full bank details: the "DuitNow QR" choice. */
  payByQr: boolean;
  /** The owner's own DuitNow QR, which the choice is named after when CHIP sits beside it. */
  hasQr: boolean;
  /**
   * The methods the owner's CHIP account listed when last checked, for checkout's first
   * draw (the API says what it takes at the order's total); null when there is no
   * account, or CHIP refused its key, or (in production) it is a test key.
   */
  chipMethods: string[] | null;
}

/** The shop plus what checkout draws; null for a personal page or a closed Store. */
export async function getCheckout(handle: string, now = new Date()): Promise<Checkout | null> {
  const shop = await getPublicShop(handle, now);
  if (!shop) return null;
  const page = await prismaRead.page.findUnique({
    where: { handle: handle.toLowerCase() },
    select: {
      mode: true,
      paidUntil: true,
      ordersPlaced: true,
      ordersAtTrialReset: true,
      paymentQrKey: true,
      bankName: true,
      bankAccountName: true,
      bankAccountNumber: true,
      // Never the sealed key: the read-only role cannot read that column at all.
      paymentAccount: { select: { methods: true, isTest: true, lastErrorAt: true } },
    },
  });
  if (!page) return null;
  const { paymentQrKey, bankName, bankAccountName, bankAccountNumber, paymentAccount: chip, ...plan } = page;
  return {
    ...shop,
    canTakeOrders: canTakeOrders({ ...plan, now }),
    // The same rule as storeGaps: a QR, or all three bank details.
    payByQr: Boolean(paymentQrKey || (bankName && bankAccountName && bankAccountNumber)),
    hasQr: Boolean(paymentQrKey),
    chipMethods: usableChipMethods(chip),
  };
}

/**
 * One available item by its slug, with the shop it is on (everything
 * `getCheckout` gives, items included, so a caller can price the basket); null
 * for an unknown or unavailable slug, a personal page or a closed Store. The
 * slug is unique per page, so the handle is part of the question.
 */
export async function getShopItem(handle: string, slug: string, now = new Date()): Promise<{ shop: Checkout; item: PublicItem } | null> {
  const shop = await getCheckout(handle, now);
  const item = shop?.items.find((candidate) => candidate.slug === slug);
  return shop && item ? { shop, item } : null;
}
