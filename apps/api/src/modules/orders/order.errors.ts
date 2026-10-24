import type { DigitalFacts } from '@curios/core/digital';

/** What PRICES_CHANGED hands back: the shelf, in getPublicShop's item shape. */
interface ShelfBase {
  id: string;
  name: string;
  description: string | null;
  photoKey: string | null;
  priceCents: number | null;
  options: { id: string; label: string; priceCents: number }[];
}

/** A shelf item with the digital facts the shop shows (see digitalFacts). */
export type ShelfItem = ShelfBase & DigitalFacts;

/** The Store is off: there is no shop to order from. */
export class StoreClosedError extends Error {
  readonly statusCode = 404;
  readonly code = 'STORE_CLOSED';
  constructor() {
    super('This shop is closed.');
    this.name = 'StoreClosedError';
  }
}

/** canTakeOrders said no: the free orders are used and nothing is paid, or the plan lapsed. */
export class OrdersPausedError extends Error {
  readonly statusCode = 409;
  readonly code = 'ORDERS_PAUSED';
  constructor() {
    super("This shop isn't taking orders right now. Send your basket on WhatsApp instead.");
    this.name = 'OrdersPausedError';
  }
}

/** The page's delivery as it is now: a fee change moves the total as much as a price does. */
export interface ShelfDelivery {
  mode: 'NONE' | 'FLAT' | 'RIDER';
  feeCents: number | null;
}

/**
 * The server's total is not the one the visitor saw. Carries the current shelf
 * and delivery so checkout can reload both (with only the shelf, a changed fee
 * would refuse every retry); the order route sends them beside the error
 * itself, because the errors plugin only ever sends `{ code, message }`.
 */
export class PricesChangedError extends Error {
  readonly statusCode = 409;
  readonly code = 'PRICES_CHANGED';
  constructor(
    readonly items: ShelfItem[],
    readonly delivery: ShelfDelivery,
  ) {
    super('Prices changed since you opened the shop. Check your basket and try again.');
    this.name = 'PricesChangedError';
  }
}

/** Taken down, deleted, another shop's, or an option that is not its own. */
export class ItemUnavailableError extends Error {
  readonly statusCode = 409;
  readonly code = 'ITEM_UNAVAILABLE';
  /** `name` is null for an item this shop does not have: naming another shop's item would leak it. */
  constructor(name: string | null) {
    super(name === null ? "One of your items isn't available any more." : `${name} isn't available any more.`);
    this.name = 'ItemUnavailableError';
  }
}

/** Over ORDER_TOTAL_MAX_CENTS: more than one stored total can hold, and more than any real basket. */
export class OrderTooLargeError extends Error {
  readonly statusCode = 400;
  readonly code = 'ORDER_TOO_LARGE';
  constructor() {
    super('This order is too big to place here. Send it to the shop on WhatsApp instead.');
    this.name = 'OrderTooLargeError';
  }
}

export class OrderDateError extends Error {
  readonly statusCode = 400;
  readonly code = 'ORDER_DATE';
  constructor() {
    super('Pick one of the days shown.');
    this.name = 'OrderDateError';
  }
}

export class MethodOffError extends Error {
  readonly statusCode = 400;
  readonly code = 'METHOD_OFF';
  constructor(method: 'PICKUP' | 'DELIVERY') {
    super(`${method === 'PICKUP' ? 'Pickup' : 'Delivery'} isn't offered right now.`);
    this.name = 'MethodOffError';
  }
}

export class AddressRequiredError extends Error {
  readonly statusCode = 400;
  readonly code = 'ADDRESS_REQUIRED';
  constructor() {
    super('Add the address for delivery.');
    this.name = 'AddressRequiredError';
  }
}

/** The order link matches no order. The same answer for a wrong token as for a stale one. */
export class OrderNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'ORDER_NOT_FOUND';
  constructor() {
    super("We couldn't find that order.");
    this.name = 'OrderNotFoundError';
  }
}

/** PAID or COMPLETED: the owner has the money, so a receipt can no longer change. */
export class OrderAlreadyPaidError extends Error {
  readonly statusCode = 409;
  readonly code = 'ORDER_ALREADY_PAID';
  constructor() {
    super('This order is already paid.');
    this.name = 'OrderAlreadyPaidError';
  }
}

/** A receipt is already with the shop: paying online as well would be a second payment, so none is started. */
export class OrderReceiptSentError extends Error {
  readonly statusCode = 409;
  readonly code = 'ORDER_RECEIPT_SENT';
  constructor(shop: string) {
    super(`Your receipt is with ${shop} to check. They'll confirm it soon.`);
    this.name = 'OrderReceiptSentError';
  }
}

export class OrderCancelledError extends Error {
  readonly statusCode = 409;
  readonly code = 'ORDER_CANCELLED';
  constructor() {
    super('This order was cancelled.');
    this.name = 'OrderCancelledError';
  }
}

/** An owner's move on an order that is no longer in the state it needs: someone (or another tab) moved it first. */
export class OrderStateError extends Error {
  readonly statusCode = 409;
  readonly code = 'ORDER_STATE';
  constructor() {
    super('This order has already moved on. Refresh to see where it is.');
    this.name = 'OrderStateError';
  }
}

/** The owner tried to cancel an order a customer had just paid online: it is marked paid instead. */
export class OrderJustPaidError extends Error {
  readonly statusCode = 409;
  readonly code = 'ORDER_JUST_PAID';
  constructor() {
    super('This order was just paid online.');
    this.name = 'OrderJustPaidError';
  }
}

/** A digital item with nothing left to give: no file, no link, or the last code or seat is gone. */
export class SoldOutError extends Error {
  readonly statusCode = 409;
  readonly code = 'SOLD_OUT';
  constructor(name: string) {
    super(`${name} is sold out.`);
    this.name = 'SoldOutError';
  }
}

/** The class time picked is full, has passed, or is not one of this item's. */
export class TimeFullError extends Error {
  readonly statusCode = 409;
  readonly code = 'TIME_FULL';
  constructor(name: string) {
    super(`That time for ${name} is full or has passed. Pick another time.`);
    this.name = 'TimeFullError';
  }
}

/** A digital item in the basket and no email to send it to. */
export class EmailRequiredError extends Error {
  readonly statusCode = 400;
  readonly code = 'EMAIL_REQUIRED';
  constructor() {
    super('Add the email where we should send your digital items.');
    this.name = 'EmailRequiredError';
  }
}

/** A session item with no time picked in the basket line. */
export class TimeRequiredError extends Error {
  readonly statusCode = 400;
  readonly code = 'TIME_REQUIRED';
  constructor(name: string) {
    super(`Pick a time for ${name}.`);
    this.name = 'TimeRequiredError';
  }
}

/** How to get the order contradicts its basket: a day or method on a digital-only order, or none on one with a physical item. */
export class OrderShapeError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_ORDER';
  constructor(message: string) {
    super(message);
    this.name = 'OrderShapeError';
  }
}
