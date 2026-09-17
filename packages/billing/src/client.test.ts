import { describe, expect, it, vi } from 'vitest';
import { BillplzUnavailableError, createBillplzClient, type FetchLike } from './client.js';

const billJson = {
  id: 'zq0tm2wc',
  collection_id: 'col-test',
  paid: false,
  state: 'due',
  amount: 3900,
  paid_amount: 0,
  reference_1_label: 'Payment',
  reference_1: 'pay-1',
  url: 'https://www.billplz-sandbox.com/bills/zq0tm2wc',
};

const input = {
  collectionId: 'col-test',
  email: 'owner@example.com',
  name: 'Nadia Bakes',
  amountCents: 3900,
  description: 'Curios Business, 1 month — Nadia Bakes',
  callbackUrl: 'https://api.example/billing/billplz/callback',
  redirectUrl: 'https://api.example/billing/billplz/return',
  reference1: 'pay-1',
};

function answering(status: number, body: unknown) {
  return vi.fn<FetchLike>(
    async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

const clientWith = (send: FetchLike, timeoutMs?: number) =>
  createBillplzClient({ apiKey: 'secret-key', baseUrl: 'https://www.billplz-sandbox.com/', fetch: send, timeoutMs });

describe('createBill', () => {
  it('posts a form with basic auth and the amount in cents', async () => {
    const send = answering(200, billJson);

    const bill = await clientWith(send).createBill(input);

    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe('https://www.billplz-sandbox.com/api/v3/bills');
    expect(init?.method).toBe('POST');
    // The API key is the Basic-auth username; there is no password.
    expect(init?.headers.authorization).toBe(`Basic ${Buffer.from('secret-key:').toString('base64')}`);
    expect(Object.fromEntries(new URLSearchParams(init?.body))).toEqual({
      collection_id: 'col-test',
      email: 'owner@example.com',
      name: 'Nadia Bakes',
      amount: '3900',
      description: 'Curios Business, 1 month — Nadia Bakes',
      callback_url: 'https://api.example/billing/billplz/callback',
      redirect_url: 'https://api.example/billing/billplz/return',
      reference_1_label: 'Payment',
      reference_1: 'pay-1',
    });
    expect(bill).toEqual({
      id: 'zq0tm2wc',
      collectionId: 'col-test',
      paid: false,
      state: 'due',
      amount: 3900,
      paidAmount: 0,
      reference1: 'pay-1',
      url: 'https://www.billplz-sandbox.com/bills/zq0tm2wc',
    });
  });
});

describe('getBill', () => {
  it('fetches a bill by id and reads it into our shape', async () => {
    const send = answering(200, { ...billJson, paid: true, state: 'paid', paid_amount: 3900 });

    const bill = await clientWith(send).getBill('zq0tm2wc');

    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe('https://www.billplz-sandbox.com/api/v3/bills/zq0tm2wc');
    expect(init?.method).toBe('GET');
    expect(bill).toMatchObject({ paid: true, state: 'paid', paidAmount: 3900, reference1: 'pay-1' });
  });
});

describe('when Billplz misbehaves', () => {
  it('treats a network failure as Billplz being unavailable', async () => {
    const send = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(clientWith(send).getBill('zq0tm2wc')).rejects.toBeInstanceOf(BillplzUnavailableError);
  });

  it('treats a 5xx as Billplz being unavailable', async () => {
    await expect(clientWith(answering(503, {})).createBill(input)).rejects.toBeInstanceOf(
      BillplzUnavailableError,
    );
  });

  it('treats a 4xx as our own misconfiguration, not an outage to wait out', async () => {
    const attempt = clientWith(answering(401, { error: { message: 'Unauthorized' } })).createBill(input);

    await expect(attempt).rejects.toThrow(/refused POST \/api\/v3\/bills with 401/);
    await expect(attempt).rejects.not.toBeInstanceOf(BillplzUnavailableError);
  });

  it('refuses a bill in a shape it does not recognise', async () => {
    await expect(clientWith(answering(200, { id: 1 })).getBill('zq0tm2wc')).rejects.toThrow(
      /does not recognise/,
    );
  });

  it('gives up on a Billplz that never answers', async () => {
    const send = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    await expect(clientWith(send, 20).getBill('zq0tm2wc')).rejects.toBeInstanceOf(BillplzUnavailableError);
  });
});
