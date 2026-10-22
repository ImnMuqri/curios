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

/** A Brand ID or secret key that cannot be one: checked before anything is sent to CHIP. */
export class InvalidChipKeyError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_CHIP_KEY';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidChipKeyError';
  }
}

/** CHIP refused the owner's key or Brand ID. */
export class ChipKeyRefusedError extends Error {
  readonly statusCode = 400;
  readonly code = 'CHIP_KEY_REFUSED';
  constructor() {
    super("That key or Brand ID didn't work. Copy both again from your CHIP dashboard, under Developers.");
    this.name = 'ChipKeyRefusedError';
  }
}

/** A CHIP test key, where only a live one can take an order's money. */
export class ChipTestKeyError extends Error {
  readonly statusCode = 400;
  readonly code = 'CHIP_TEST_KEY';
  constructor() {
    super('This is a test key. Connect your live secret key from your CHIP dashboard, under Developers.');
    this.name = 'ChipTestKeyError';
  }
}

/** The owner's account takes no card or e-wallet, so there is nothing to test RM1 with. */
export class ChipNoTestMethodError extends Error {
  readonly statusCode = 400;
  readonly code = 'CHIP_NO_TEST_METHOD';
  constructor() {
    super('Your CHIP account takes no card or e-wallet yet, so there is nothing to test with. Turn one on in CHIP first.');
    this.name = 'ChipNoTestMethodError';
  }
}

/** CHIP would not start the test payment, for a reason other than the key. */
export class ChipTestRefusedError extends Error {
  readonly statusCode = 400;
  readonly code = 'CHIP_TEST_REFUSED';
  constructor() {
    super('CHIP would not start a test payment. Check your account in the CHIP dashboard, then try again.');
    this.name = 'ChipTestRefusedError';
  }
}

export class ChipNotConnectedError extends Error {
  readonly statusCode = 409;
  readonly code = 'CHIP_NOT_CONNECTED';
  constructor() {
    super('Connect CHIP first.');
    this.name = 'ChipNotConnectedError';
  }
}

/**
 * Development only: PAYMENT_SECRETS_KEY is not set, so there is nowhere safe to keep a
 * key. A 503 like BILLING_NOT_CONFIGURED; production refuses to start without it.
 */
export class ChipNotConfiguredError extends Error {
  readonly statusCode = 503;
  readonly code = 'CHIP_NOT_CONFIGURED';
  constructor() {
    super('Connecting CHIP is not configured in this environment.');
    this.name = 'ChipNotConfiguredError';
  }
}
