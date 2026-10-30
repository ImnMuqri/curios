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

export class InvalidItemPhotoError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_PHOTO';
  constructor() {
    super('Use a JPEG, PNG or WebP picture, up to 8 MB.');
    this.name = 'InvalidItemPhotoError';
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
/**
 * Connecting checks the key with a purchase it cancels at once, offered by card or
 * e-wallet, or by FPX alone when the account has neither, and never by CHIP's DuitNow
 * QR; an account with none of them cannot be checked.
 */
export class ChipNoCheckMethodError extends Error {
  readonly statusCode = 400;
  readonly code = 'CHIP_NO_CHECK_METHOD';
  constructor() {
    super('Your CHIP account takes no FPX, card or e-wallet yet, so Curios can’t check it. Turn one on in CHIP, then connect again.');
    this.name = 'ChipNoCheckMethodError';
  }
}

export class ChipNoTestMethodError extends Error {
  readonly statusCode = 400;
  readonly code = 'CHIP_NO_TEST_METHOD';
  constructor() {
    super('Test with RM1 needs card or e-wallet on your CHIP account.');
    this.name = 'ChipNoTestMethodError';
  }
}

/** CHIP would not start the test payment, for a reason other than the key. */
export class ChipTestRefusedError extends Error {
  readonly statusCode = 400;
  readonly code = 'CHIP_TEST_REFUSED';
  constructor() {
    super('CHIP would not start a payment on this account. Check it in the CHIP dashboard, then try again.');
    this.name = 'ChipTestRefusedError';
  }
}

/**
 * The kept key can no longer be opened (PAYMENT_SECRETS_KEY was rotated): only
 * connecting again, with the key from CHIP's dashboard, mends it.
 */
export class ChipReconnectError extends Error {
  readonly statusCode = 409;
  readonly code = 'CHIP_RECONNECT';
  constructor() {
    super('Connect CHIP again.');
    this.name = 'ChipReconnectError';
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

/** A customer may be paying through the CHIP account right now: it cannot go, or be swapped, until that purchase can no longer be paid. */
export class ChipPaymentInFlightError extends Error {
  readonly statusCode = 409;
  readonly code = 'CHIP_PAYMENT_IN_FLIGHT';
  constructor() {
    super('A customer is paying right now. Try again in an hour.');
    this.name = 'ChipPaymentInFlightError';
  }
}

/** The item already holds the most files it may. */
export class TooManyFilesError extends Error {
  readonly statusCode = 409;
  readonly code = 'TOO_MANY_FILES';
  constructor(max: number) {
    super(`An item holds at most ${max} files. Remove one to add another.`);
    this.name = 'TooManyFilesError';
  }
}

/** A file over the size limit, by its declared length or by the bytes that actually arrived. */
export class FileTooBigError extends Error {
  readonly statusCode = 413;
  readonly code = 'FILE_TOO_BIG';
  constructor(mb: number) {
    super(`That file is over ${mb} MB. Choose a smaller one.`);
    this.name = 'FileTooBigError';
  }
}

/** A file of a type a digital item does not take. */
export class FileTypeError extends Error {
  readonly statusCode = 415;
  readonly code = 'FILE_TYPE';
  constructor() {
    super('Files can be a PDF, image, ZIP, audio or video.');
    this.name = 'FileTypeError';
  }
}

/** A file with no usable name or length, or whose bytes did not match its length. */
export class InvalidFileError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_FILE';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFileError';
  }
}

/** Files, codes and times belong to an item set up to deliver them. */
export class WrongDeliveryError extends Error {
  readonly statusCode = 409;
  readonly code = 'WRONG_DELIVERY';
  constructor(what: string) {
    super(`Set this item to ${what} first.`);
    this.name = 'WrongDeliveryError';
  }
}

/** Codes that are too long, or too many for one item. */
export class InvalidCodesError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_CODES';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCodesError';
  }
}

/** A code already given to a buyer cannot be removed. */
export class CodeUsedError extends Error {
  readonly statusCode = 409;
  readonly code = 'CODE_USED';
  constructor() {
    super('That code was given to a buyer, so it stays.');
    this.name = 'CodeUsedError';
  }
}

/** A session time or seat count that fails its rule. */
export class InvalidSessionError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_SESSION';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSessionError';
  }
}

/** Seats cannot drop below the seats already booked. */
export class SeatsBookedError extends Error {
  readonly statusCode = 409;
  readonly code = 'SEATS_BOOKED';
  constructor(booked: number) {
    super(`${booked} seats are already booked. Seats cannot go below that.`);
    this.name = 'SeatsBookedError';
  }
}

/** A session time with bookings cannot be removed. */
export class SessionBookedError extends Error {
  readonly statusCode = 409;
  readonly code = 'SESSION_BOOKED';
  constructor() {
    super('This time has bookings, so it stays.');
    this.name = 'SessionBookedError';
  }
}

/** An item with booked sessions cannot be removed. */
export class ItemHasBookingsError extends Error {
  readonly statusCode = 409;
  readonly code = 'ITEM_HAS_BOOKINGS';
  constructor() {
    super('This item has booked times, so it stays. Hide it from your shop instead.');
    this.name = 'ItemHasBookingsError';
  }
}

/** An item whose codes were given to buyers cannot be removed: deleting it would delete their codes. */
export class ItemHasSalesError extends Error {
  readonly statusCode = 409;
  readonly code = 'ITEM_HAS_SALES';
  constructor() {
    super('Buyers hold codes from this item. Mark it unavailable instead.');
    this.name = 'ItemHasSalesError';
  }
}

export class FileNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('No such file.');
    this.name = 'FileNotFoundError';
  }
}

export class CodeNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('No such code.');
    this.name = 'CodeNotFoundError';
  }
}

export class SessionNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('No such time.');
    this.name = 'SessionNotFoundError';
  }
}
