export class StoreBusinessOnlyError extends Error {
  readonly statusCode = 403;
  readonly code = 'STORE_BUSINESS_ONLY';
  constructor() {
    super('A shop is part of a business page. You can make this a business page from Billing.');
    this.name = 'StoreBusinessOnlyError';
  }
}

export class StoreNotReadyError extends Error {
  readonly statusCode = 400;
  readonly code = 'STORE_NOT_READY';
  constructor(message: string) {
    super(message);
    this.name = 'StoreNotReadyError';
  }
}

export class InvalidStoreSettingError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_STORE_SETTING';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStoreSettingError';
  }
}

export class InvalidItemError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_ITEM';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidItemError';
  }
}

export class ItemLimitError extends Error {
  readonly statusCode = 400;
  readonly code = 'ITEM_LIMIT';
  constructor(max: number) {
    super(`A shop holds at most ${max} items. Remove one to add another.`);
    this.name = 'ItemLimitError';
  }
}

export class ItemNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('No such item.');
    this.name = 'ItemNotFoundError';
  }
}

/** Another tab changed the items after this one loaded them. */
export class ItemOrderStaleError extends Error {
  readonly statusCode = 409;
  readonly code = 'ITEM_ORDER_STALE';
  constructor() {
    super('Your items changed somewhere else. Reload to see the latest, then try again.');
    this.name = 'ItemOrderStaleError';
  }
}
