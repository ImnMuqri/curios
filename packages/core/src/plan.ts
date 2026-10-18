/**
 * How many leads a page may capture before it has to pay.
 *
 * Three, and counted rather than timed. A fourteen-day trial can expire having
 * produced nothing, which teaches an owner the product does not work and
 * spends the model budget proving it; a lead trial ends only once the product
 * has demonstrably worked. A page that never captures anything never pays and
 * never feels cheated.
 *
 * Not an env var, unlike the conversation cap. That one is an operational dial
 * for spend; this is a promise printed on a pricing page.
 */
export const FREE_LEADS = 3;

export interface PlanInput {
  mode: 'PERSONAL' | 'BUSINESS';
  paidUntil: Date | null;
  leadsCaptured: number;
  now: Date;
}

/**
 * Why a page is or is not allowed to capture.
 *
 * `canCapture` is the enforcement answer and this is the explanation. They are
 * the same rule, and it matters that they cannot drift: a page hidden from the
 * visitor for one reason while the owner is told another is worse than either
 * message alone.
 *
 * `lapsed` and `trialSpent` both refuse, and they are separate because the
 * owner needs different things said. One has never paid. The other has, and
 * needs to renew.
 */
export type PlanState =
  | { kind: 'personal' }
  | { kind: 'paid'; paidUntil: Date }
  | {
      /**
       * `lapsedOn` is set when this page paid before and that payment has expired --
       * a subscription can end while free leads remain, because the rule below is an
       * OR. Optional rather than a state of its own: capture is unaffected, and only
       * the wording an owner reads changes.
       */
      kind: 'trial';
      used: number;
      remaining: number;
      lapsedOn?: Date;
    }
  | { kind: 'trialSpent' }
  | { kind: 'lapsed'; paidUntil: Date };

export function planState(input: PlanInput): PlanState {
  if (input.mode !== 'BUSINESS') return { kind: 'personal' };

  // `>` and not `>=`: the instant a payment expires, it has expired.
  if (input.paidUntil !== null && input.paidUntil.getTime() > input.now.getTime()) {
    return { kind: 'paid', paidUntil: input.paidUntil };
  }

  // Checked after the payment and before the lapse, because a page that paid,
  // captured once, and lapsed still has trial left. The rule is an OR.
  if (input.leadsCaptured < FREE_LEADS) {
    return {
      kind: 'trial',
      used: input.leadsCaptured,
      remaining: FREE_LEADS - input.leadsCaptured,
      // Spread, not `lapsedOn: input.paidUntil ?? undefined`: an explicit
      // `lapsedOn: undefined` is a property the object has, and `toEqual` in the
      // test above distinguishes that from a property it does not have.
      ...(input.paidUntil !== null ? { lapsedOn: input.paidUntil } : {}),
    };
  }

  return input.paidUntil === null
    ? { kind: 'trialSpent' }
    : { kind: 'lapsed', paidUntil: input.paidUntil };
}

/**
 * Whether this page may take a phone number.
 *
 * The one thing a lapsed page loses. Everything else it keeps -- the FAQ pages
 * stay indexed, the public page stays indexed, chat keeps answering at the
 * same cap. Withdrawing FAQ generation would 404 URLs the owner earned in
 * search, and rankings do not return the moment a bill is paid. Capture is
 * what README says a business pays for, so capture is what stops.
 *
 * Derived from `planState` rather than deciding for itself. Two functions
 * expressing one rule is how a page and an endpoint end up disagreeing about
 * the same page; a test walks every combination to prove these two do not.
 *
 * `now` is a parameter and not `new Date()`. A function that reads the clock
 * cannot be tested at the instant its answer changes -- and this one has a
 * boundary that matters, since a payment expires at a particular moment.
 */
export function canCapture(input: PlanInput): boolean {
  const state = planState(input);
  return state.kind === 'paid' || state.kind === 'trial';
}

/**
 * How many orders a page may take before it has to pay.
 *
 * Three, and counted, for the reason `FREE_LEADS` is: a trial that ends only
 * once the shop has demonstrably worked never makes an owner pay for nothing.
 * It is its own allowance and not the lead one, because a page can capture
 * leads all week and never sell anything, or the other way about.
 */
export const FREE_ORDERS = 3;

export interface OrderInput {
  mode: 'PERSONAL' | 'BUSINESS';
  paidUntil: Date | null;
  ordersPlaced: number;
  /**
   * The baseline the allowance counts from. `ordersPlaced` is never decremented
   * or zeroed, because order numbers come from it and would repeat; the one
   * trial reset moves this up to meet it instead.
   */
  ordersAtTrialReset: number;
  now: Date;
}

/**
 * Why a page is or is not allowed to take orders. The same shape as
 * `PlanState`, without the `lapsedOn` extra: the order screens only need to
 * know whether the shop is open and what to tell the owner when it is not.
 */
export type OrderState =
  | { kind: 'personal' }
  | { kind: 'paid'; paidUntil: Date }
  | { kind: 'trial'; used: number; remaining: number }
  | { kind: 'trialSpent' }
  | { kind: 'lapsed'; paidUntil: Date };

export function orderState(input: OrderInput): OrderState {
  if (input.mode !== 'BUSINESS') return { kind: 'personal' };

  // `>` and not `>=`: the instant a payment expires, it has expired.
  if (input.paidUntil !== null && input.paidUntil.getTime() > input.now.getTime()) {
    return { kind: 'paid', paidUntil: input.paidUntil };
  }

  // Clamped at zero so a baseline ahead of the count can never read as a
  // negative `used` and hand out more than FREE_ORDERS.
  const used = Math.max(0, input.ordersPlaced - input.ordersAtTrialReset);
  if (used < FREE_ORDERS) {
    return { kind: 'trial', used, remaining: FREE_ORDERS - used };
  }

  return input.paidUntil === null
    ? { kind: 'trialSpent' }
    : { kind: 'lapsed', paidUntil: input.paidUntil };
}

/**
 * Whether this page may take an order.
 *
 * Derived from `orderState` so the shop, the API, Alerts and Billing cannot
 * disagree about the same page: nothing else decides it.
 */
export function canTakeOrders(input: OrderInput): boolean {
  const state = orderState(input);
  return state.kind === 'paid' || state.kind === 'trial';
}
