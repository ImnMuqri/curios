import { parsePublicKey } from './signature.js';

/** A CHIP purchase, narrowed to what billing needs. Money is in sen. */
export interface ChipPurchase {
  id: string;
  status: string;
  reference: string;
  totalCents: number;
  checkoutUrl: string;
  /** True once a card was saved on this purchase: its id can then be charged again. */
  isRecurringToken: boolean;
  isTest: boolean;
  paymentMethod: string | null;
  maskedPan: string | null;
  /** The brand's name, from the purchase's issuer details; absent when CHIP leaves it blank. */
  brandName?: string;
  /** CHIP's own reference for the purchase (`reference_generated`); absent when blank. */
  referenceGenerated?: string;
  /** The purchase's notes, as it was created with them; absent when blank. */
  notes?: string;
  /** The purchase's currency, when CHIP says it. */
  currency?: string;
}

/** One line of a purchase. Money is in sen. */
export interface PurchaseProduct {
  name: string;
  priceCents: number;
  quantity: number;
}

export interface CreatePurchaseInput {
  email: string;
  fullName: string;
  productName: string;
  amountCents: number;
  reference: string;
  successCallback?: string;
  redirectUrl?: string;
  dueAt: Date;
  sendReceipt: boolean;
  /** Ask for a saved card (for auto-renew), and offer cards only, as only cards can be saved. */
  cardsOnlyRecurring: boolean;
  /** Offer only these payment methods (CHIP's `payment_method_whitelist`). Ignored with cardsOnlyRecurring. */
  methods?: string[];
  /** Several lines (an order's), sent in place of the one `productName` at `amountCents`. */
  products?: PurchaseProduct[];
  /** The client's phone, in CHIP's `+60 123456789` form. */
  phone?: string;
  /** The purchase's notes. */
  notes?: string;
}

export type ChargeResult =
  | { kind: 'paid' | 'pending'; purchase: ChipPurchase }
  | { kind: 'invalid-token' }
  | { kind: 'declined' };

export interface ChipClient {
  createPurchase(input: CreatePurchaseInput): Promise<ChipPurchase>;
  getPurchase(id: string): Promise<ChipPurchase>;
  chargePurchase(id: string, recurringToken: string): Promise<ChargeResult>;
  deleteRecurringToken(id: string): Promise<void>;
  cancelPurchase(id: string): Promise<void>;
  getPublicKey(): Promise<string>;
  /** The method names this key and brand can take at this amount (`GET /payment_methods/`). */
  listPaymentMethods(amountCents: number): Promise<string[]>;
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Response>;

/**
 * CHIP could not be reached, timed out, or answered 5xx -- an outage, worth an owner
 * trying again later. Deliberately NOT what a 4xx becomes: a refused request means our
 * key or our payload is wrong, and telling owners to retry a misconfiguration is the
 * mistake OAUTH_EXCHANGE_FAILED was kept off the error allow-list to avoid.
 */
export class ChipUnavailableError extends Error {
  readonly statusCode = 502;
  readonly code = 'CHIP_UNAVAILABLE';
  constructor(detail: string) {
    super(`CHIP is unavailable: ${detail}`);
    this.name = 'ChipUnavailableError';
  }
}

/**
 * CHIP answered a 4xx: the key, the brand or the request is wrong. `status` says which
 * kind, so a caller checking an owner's own key can tell "that key didn't work" (401,
 * 403, 400) from an outage, which is ChipUnavailableError. The message carries CHIP's
 * body for a developer reading a stack trace; log the name, never the message.
 */
export class ChipRefusedError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ChipRefusedError';
    this.status = status;
  }
}

/**
 * What CHIP says about a purchase that will never be paid. `overdue` is a purchase past
 * its due time; every purchase here is made due_strict, so CHIP should say `expired`
 * instead, but an overdue one is not waited on either (it is still cancelled before a
 * new one is made, as it could still be paid).
 */
export const DEAD_PURCHASE_STATUSES: ReadonlySet<string> = new Set(['expired', 'cancelled', 'error', 'blocked', 'overdue']);

/**
 * What CHIP says about a purchase that is paid: `paid`, then for some card payments
 * `cleared` and `settled` as the funds move on (CHIP's Purchase.status). All three are paid.
 */
export const PAID_PURCHASE_STATUSES: ReadonlySet<string> = new Set(['paid', 'cleared', 'settled']);

/**
 * A purchase that was paid and has since been (or is being) reversed: refunded in full or
 * part, or charged back. The money was taken, so it is recorded as paid, never taken for
 * a purchase that was not paid.
 */
export const REVERSED_PURCHASE_STATUSES: ReadonlySet<string> = new Set(['pending_refund', 'refunded', 'chargeback']);

/** Whether CHIP took the money for this purchase at some point: paid, or paid and then reversed. */
export const wasPaid = (status: string): boolean => PAID_PURCHASE_STATUSES.has(status) || REVERSED_PURCHASE_STATUSES.has(status);

/** Card schemes a saved card can come from; CHIP only saves cards for recurring use. */
const CARD_METHODS = ['visa', 'mastercard', 'maestro'];

export function createChipClient(options: {
  secretKey: string;
  brandId: string;
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}): ChipClient {
  const send: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const authorization = `Bearer ${options.secretKey}`;
  const base = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 10_000;

  /** Sends a request; an outage becomes ChipUnavailableError, everything else is the caller's. */
  async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await send(`${base}${path}`, {
        method,
        headers:
          body === undefined ? { authorization } : { authorization, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new ChipUnavailableError(String(error));
    }
    if (response.status >= 500) {
      throw new ChipUnavailableError(`${method} ${path} answered ${response.status}`);
    }
    return response;
  }

  async function refused(method: string, path: string, response: Response): Promise<Error> {
    return new ChipRefusedError(`CHIP refused ${method} ${path} with ${response.status}: ${await response.text()}`, response.status);
  }

  async function purchaseCall(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ChipPurchase> {
    const response = await request(method, path, body);
    if (!response.ok) throw await refused(method, path, response);
    return toPurchase(await response.json());
  }

  const purchasePath = (id: string) => `/purchases/${encodeURIComponent(id)}/`;

  return {
    createPurchase: (input) => {
      // CHIP rejects a success_callback with an explicit port (webhooks_callback_port),
      // which a local API on :3001 always has. A purchase without a callback still works:
      // the redirect and the hourly check settle it, so omit it rather than fail the order.
      const callback =
        input.successCallback && new URL(input.successCallback).port === ''
          ? input.successCallback
          : undefined;
      return purchaseCall('POST', '/purchases/', {
        brand_id: options.brandId,
        client: { email: input.email, full_name: input.fullName, ...(input.phone ? { phone: input.phone } : {}) },
        purchase: {
          currency: 'MYR',
          // CHIP's schema types quantity as a string, so send one.
          products: input.products
            ? input.products.map((product) => ({ name: product.name, price: product.priceCents, quantity: String(product.quantity) }))
            : [{ name: input.productName, price: input.amountCents, quantity: '1' }],
          // An unpaid purchase must stop being payable at `due`, not linger past its period.
          due_strict: true,
        },
        due: Math.floor(input.dueAt.getTime() / 1000),
        reference: input.reference,
        ...(input.notes ? { notes: input.notes } : {}),
        ...(callback ? { success_callback: callback } : {}),
        ...(input.redirectUrl
          ? {
              success_redirect: input.redirectUrl,
              failure_redirect: input.redirectUrl,
              cancel_redirect: input.redirectUrl,
            }
          : {}),
        send_receipt: input.sendReceipt,
        ...(input.cardsOnlyRecurring
          ? { force_recurring: true, payment_method_whitelist: CARD_METHODS }
          : input.methods
            ? { payment_method_whitelist: input.methods }
            : {}),
      });
    },

    getPurchase: (id) => purchaseCall('GET', purchasePath(id)),

    async chargePurchase(id, recurringToken) {
      const path = `${purchasePath(id)}charge/`;
      const response = await request('POST', path, { recurring_token: recurringToken });
      if (response.status === 400) {
        const text = await response.text();
        const code = errorCode(text);
        // No charge was attempted for a dead token; a declined one was attempted and failed.
        if (code === 'invalid_recurring_token') return { kind: 'invalid-token' };
        if (code === 'purchase_charge_error') return { kind: 'declined' };
        throw new Error(`CHIP refused POST ${path} with 400: ${text}`);
      }
      if (!response.ok) throw await refused('POST', path, response);
      const purchase = toPurchase(await response.json());
      // A slow acquirer answers pending_charge; the purchase.paid webhook settles it later.
      if (purchase.status === 'paid') return { kind: 'paid', purchase };
      if (purchase.status === 'pending_charge') return { kind: 'pending', purchase };
      throw new Error(`CHIP answered a charge with an unexpected status: ${purchase.status}`);
    },

    async deleteRecurringToken(id) {
      const path = `${purchasePath(id)}delete_recurring_token/`;
      const response = await request('POST', path);
      if (!response.ok) throw await refused('POST', path, response);
    },

    async cancelPurchase(id) {
      const path = `${purchasePath(id)}cancel/`;
      const response = await request('POST', path);
      if (!response.ok) throw await refused('POST', path, response);
    },

    async getPublicKey() {
      const response = await request('GET', '/public_key/');
      if (!response.ok) throw await refused('GET', '/public_key/', response);
      return parsePublicKey(await response.text());
    },

    async listPaymentMethods(amountCents) {
      const query = new URLSearchParams({ brand_id: options.brandId, currency: 'MYR', amount: String(amountCents) });
      const path = `/payment_methods/?${query.toString()}`;
      const response = await request('GET', path);
      if (!response.ok) throw await refused('GET', '/payment_methods/', response);
      const methods = ((await response.json()) as { available_payment_methods?: unknown } | null)?.available_payment_methods;
      if (!Array.isArray(methods) || !methods.every((name): name is string => typeof name === 'string')) {
        throw new Error('CHIP returned payment methods in a shape this client does not recognise');
      }
      return methods;
    },
  };
}

/**
 * The error code of a CHIP 400. The reference documents `{"__all__": [{code}]}` but its
 * generic 400 example shows `{"__all__": {code}}`, so both are read.
 */
function errorCode(text: string): string | null {
  try {
    const all = (JSON.parse(text) as { __all__?: unknown }).__all__;
    const first: unknown = Array.isArray(all) ? (all[0] as unknown) : all;
    const code = (first as { code?: unknown } | null | undefined)?.code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

/**
 * CHIP's purchase JSON, narrowed to what billing needs. A shape we do not recognise
 * throws rather than guessing: a purchase whose total might be a string is not one to
 * grant paid time on. `reference` may legitimately be empty.
 */
function toPurchase(raw: unknown): ChipPurchase {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('CHIP returned something that is not a purchase');
  }
  const p = raw as Record<string, unknown>;
  const inner = p.purchase as { total?: unknown; currency?: unknown } | null | undefined;
  if (
    typeof p.id !== 'string' ||
    typeof p.status !== 'string' ||
    typeof p.reference !== 'string' ||
    typeof inner !== 'object' ||
    inner === null ||
    typeof inner.total !== 'number' ||
    typeof p.checkout_url !== 'string' ||
    typeof p.is_recurring_token !== 'boolean' ||
    typeof p.is_test !== 'boolean'
  ) {
    throw new Error('CHIP returned a purchase in a shape this client does not recognise');
  }
  const data = p.transaction_data as { payment_method?: unknown; extra?: { masked_pan?: unknown } } | null | undefined;
  const method = data?.payment_method;
  const pan = data?.extra?.masked_pan;
  const brand = (p.issuer_details as { brand_name?: unknown } | null | undefined)?.brand_name;
  const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
  return {
    id: p.id,
    status: p.status,
    reference: p.reference,
    totalCents: inner.total,
    checkoutUrl: p.checkout_url,
    isRecurringToken: p.is_recurring_token,
    isTest: p.is_test,
    // CHIP sends '' until a method was used.
    paymentMethod: typeof method === 'string' && method !== '' ? method : null,
    maskedPan: typeof pan === 'string' && pan !== '' ? pan : null,
    ...(nonBlank(brand) ? { brandName: brand.trim() } : {}),
    ...(nonBlank(p.reference_generated) ? { referenceGenerated: p.reference_generated.trim() } : {}),
    ...(nonBlank(p.notes) ? { notes: p.notes } : {}),
    ...(nonBlank(inner.currency) ? { currency: inner.currency } : {}),
  };
}
