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

/** What CHIP says about a purchase that will never be paid. */
export const DEAD_PURCHASE_STATUSES: ReadonlySet<string> = new Set(['expired', 'cancelled', 'error', 'blocked']);

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
    return new Error(`CHIP refused ${method} ${path} with ${response.status}: ${await response.text()}`);
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
        client: { email: input.email, full_name: input.fullName },
        purchase: {
          currency: 'MYR',
          // CHIP's schema types quantity as a string, so send one.
          products: [{ name: input.productName, price: input.amountCents, quantity: '1' }],
          // An unpaid purchase must stop being payable at `due`, not linger past its period.
          due_strict: true,
        },
        due: Math.floor(input.dueAt.getTime() / 1000),
        reference: input.reference,
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
  const inner = p.purchase as { total?: unknown } | null | undefined;
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
  };
}
