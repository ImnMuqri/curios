/**
 * What the admin's switches (Controls) answer when one is off. Each is a 503 with its own code,
 * listed in errorsPlugin's SWITCH_CODES so its sentence reaches the person as written.
 */

/** Sign-ups closed: a new account is refused, by email or by Google. Existing accounts sign in. */
export class SignupsClosedError extends Error {
  readonly statusCode = 503;
  readonly code = 'SIGNUPS_CLOSED';
  constructor() {
    super('Curios is full for now. Try again soon.');
    this.name = 'SignupsClosedError';
  }
}

/** Reading new sources paused: a re-read is refused. A new source is still taken, and waits in the paused queue. */
export class ReadingPausedError extends Error {
  readonly statusCode = 503;
  readonly code = 'READING_PAUSED';
  constructor() {
    super('Reading new sources is paused for now. Try again later.');
    this.name = 'ReadingPausedError';
  }
}

/** CHIP payments off: no plan purchase and no online payment of an order is started. */
export class PaymentsOffError extends Error {
  readonly statusCode = 503;
  readonly code = 'PAYMENTS_OFF';
  constructor() {
    super('Online payments are paused for a moment. Try again soon.');
    this.name = 'PaymentsOffError';
  }
}
