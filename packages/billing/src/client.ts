export interface BillplzBill {
  id: string;
  collectionId: string;
  paid: boolean;
  state: string;
  amount: number;
  paidAmount: number;
  reference1: string | null;
  url: string;
}

export interface CreateBillInput {
  collectionId: string;
  email: string;
  name: string;
  amountCents: number;
  description: string;
  callbackUrl: string;
  redirectUrl: string;
  reference1: string;
}

export interface BillplzClient {
  createBill(input: CreateBillInput): Promise<BillplzBill>;
  getBill(id: string): Promise<BillplzBill>;
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<Response>;

/**
 * Billplz could not be reached, timed out, or answered 5xx -- an outage, worth an owner
 * trying again later. Deliberately NOT what a 4xx becomes: a refused request means our
 * key or our payload is wrong, and telling owners to retry a misconfiguration is the
 * mistake OAUTH_EXCHANGE_FAILED was kept off the error allow-list to avoid.
 */
export class BillplzUnavailableError extends Error {
  readonly statusCode = 502;
  readonly code = 'BILLPLZ_UNAVAILABLE';
  constructor(detail: string) {
    super(`Billplz is unavailable: ${detail}`);
    this.name = 'BillplzUnavailableError';
  }
}

export function createBillplzClient(options: {
  apiKey: string;
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}): BillplzClient {
  const send: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  // The API secret key is the Basic-auth username; Billplz takes no password.
  const authorization = `Basic ${Buffer.from(`${options.apiKey}:`).toString('base64')}`;
  const base = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function call(method: 'GET' | 'POST', path: string, form?: URLSearchParams): Promise<BillplzBill> {
    let response: Response;
    try {
      response = await send(`${base}${path}`, {
        method,
        headers: form
          ? { authorization, 'content-type': 'application/x-www-form-urlencoded' }
          : { authorization },
        body: form?.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new BillplzUnavailableError(String(error));
    }

    if (response.status >= 500) {
      throw new BillplzUnavailableError(`${method} ${path} answered ${response.status}`);
    }
    if (!response.ok) {
      throw new Error(`Billplz refused ${method} ${path} with ${response.status}: ${await response.text()}`);
    }
    const raw: unknown = await response.json();
    return toBill(raw);
  }

  return {
    createBill: (input) =>
      call(
        'POST',
        '/api/v3/bills',
        new URLSearchParams({
          collection_id: input.collectionId,
          email: input.email,
          name: input.name,
          amount: String(input.amountCents),
          description: input.description,
          callback_url: input.callbackUrl,
          redirect_url: input.redirectUrl,
          reference_1_label: 'Payment',
          reference_1: input.reference1,
        }),
      ),
    getBill: (id) => call('GET', `/api/v3/bills/${encodeURIComponent(id)}`),
  };
}

/**
 * Billplz's bill JSON, narrowed to what a grant needs. A shape we do not recognise
 * throws rather than guessing: a bill whose `paid` might be a string is not one to
 * grant paid time on.
 */
function toBill(raw: unknown): BillplzBill {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Billplz returned something that is not a bill');
  }
  const bill = raw as Record<string, unknown>;
  if (
    typeof bill.id !== 'string' ||
    typeof bill.collection_id !== 'string' ||
    typeof bill.paid !== 'boolean' ||
    typeof bill.state !== 'string' ||
    typeof bill.amount !== 'number' ||
    typeof bill.url !== 'string'
  ) {
    throw new Error('Billplz returned a bill in a shape this client does not recognise');
  }
  return {
    id: bill.id,
    collectionId: bill.collection_id,
    paid: bill.paid,
    state: bill.state,
    amount: bill.amount,
    paidAmount: typeof bill.paid_amount === 'number' ? bill.paid_amount : 0,
    reference1: typeof bill.reference_1 === 'string' ? bill.reference_1 : null,
    url: bill.url,
  };
}
