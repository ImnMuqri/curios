/** What PRICES_CHANGED hands back: the shelf, in getPublicShop's item shape. */
export interface ShelfItem {
  id: string;
  name: string;
  description: string | null;
  photoKey: string | null;
  priceCents: number | null;
  options: { id: string; label: string; priceCents: number }[];
}

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

/**
 * The server's total is not the one the visitor saw. Carries the current shelf
 * so the basket can reload; the order route sends it beside the error itself,
 * because the errors plugin only ever sends `{ code, message }`.
 */
export class PricesChangedError extends Error {
  readonly statusCode = 409;
  readonly code = 'PRICES_CHANGED';
  constructor(readonly items: ShelfItem[]) {
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
