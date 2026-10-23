import { describe, expect, it, vi } from 'vitest';
import { ChipRefusedError, ChipUnavailableError, createChipClient, type FetchLike } from './client.js';

// The shape of the Purchase example in CHIP's OpenAPI reference, trimmed to what matters.
const purchaseJson = {
  id: '00000000-0000-0000-0000-000000000001',
  type: 'purchase',
  status: 'created',
  is_test: true,
  reference: 'pay-1',
  is_recurring_token: false,
  checkout_url: 'https://gate.chip-in.asia/p/00000000-0000-0000-0000-000000000001/',
  purchase: { currency: 'MYR', total: 4900, products: [{ name: 'Curios Business', price: 4900, quantity: '1.0000' }] },
  transaction_data: { payment_method: '', extra: {} },
};

const paidJson = {
  ...purchaseJson,
  status: 'paid',
  is_recurring_token: true,
  transaction_data: { payment_method: 'visa', extra: { masked_pan: '411111******1111' } },
};

const input = {
  email: 'owner@example.com',
  fullName: 'Nadia Bakes',
  productName: 'Curios Business, 1 month',
  amountCents: 4900,
  reference: 'pay-1',
  successCallback: 'https://api.example/billing/chip/callback',
  redirectUrl: 'https://api.example/billing/chip/return',
  dueAt: new Date('2026-10-23T00:00:00Z'),
  sendReceipt: true,
  cardsOnlyRecurring: false,
};

function answering(status: number, body: unknown) {
  return vi.fn<FetchLike>(
    async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

const BASE = 'https://gate.chip-in.asia/api/v1';
const clientWith = (send: FetchLike, timeoutMs?: number) =>
  createChipClient({
    secretKey: 'secret-key',
    brandId: 'brand-1',
    baseUrl: `${BASE}/`,
    fetch: send,
    timeoutMs,
  });

const sentBody = (send: ReturnType<typeof answering>) =>
  JSON.parse(send.mock.calls[0]?.[1].body ?? '{}') as Record<string, unknown>;

describe('createPurchase', () => {
  it('creates a purchase with the brand, sen products, reference and due_strict', async () => {
    const send = answering(201, purchaseJson);

    const purchase = await clientWith(send).createPurchase(input);

    const [url, init] = send.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/purchases/`);
    expect(init?.method).toBe('POST');
    expect(init?.headers.authorization).toBe('Bearer secret-key');
    expect(init?.headers['content-type']).toBe('application/json');
    expect(sentBody(send)).toEqual({
      brand_id: 'brand-1',
      client: { email: 'owner@example.com', full_name: 'Nadia Bakes' },
      purchase: {
        currency: 'MYR',
        products: [{ name: 'Curios Business, 1 month', price: 4900, quantity: '1' }],
        due_strict: true,
      },
      due: Math.floor(new Date('2026-10-23T00:00:00Z').getTime() / 1000),
      reference: 'pay-1',
      success_callback: 'https://api.example/billing/chip/callback',
      success_redirect: 'https://api.example/billing/chip/return',
      failure_redirect: 'https://api.example/billing/chip/return',
      cancel_redirect: 'https://api.example/billing/chip/return',
      send_receipt: true,
    });
    expect(purchase).toEqual({
      id: '00000000-0000-0000-0000-000000000001',
      status: 'created',
      reference: 'pay-1',
      totalCents: 4900,
      checkoutUrl: 'https://gate.chip-in.asia/p/00000000-0000-0000-0000-000000000001/',
      isRecurringToken: false,
      isTest: true,
      paymentMethod: null,
      maskedPan: null,
      currency: 'MYR',
    });
  });

  it('asks for a card token, cards only, when cardsOnlyRecurring', async () => {
    const send = answering(201, purchaseJson);

    await clientWith(send).createPurchase({ ...input, cardsOnlyRecurring: true });

    expect(sentBody(send).force_recurring).toBe(true);
    expect(sentBody(send).payment_method_whitelist).toEqual(['visa', 'mastercard', 'maestro']);
  });

  it('leaves the card options out otherwise', async () => {
    const send = answering(201, purchaseJson);

    await clientWith(send).createPurchase(input);

    expect(sentBody(send)).not.toHaveProperty('force_recurring');
    expect(sentBody(send)).not.toHaveProperty('payment_method_whitelist');
  });

  // CHIP rejects a success_callback that spells out a port (webhooks_callback_port),
  // which a local dev API on :3001 always does; no callback beats a refused purchase.
  it('omits success_callback when its URL has a port', async () => {
    const send = answering(201, purchaseJson);

    await clientWith(send).createPurchase({ ...input, successCallback: 'http://localhost:3001/billing/chip/callback' });

    expect(sentBody(send)).not.toHaveProperty('success_callback');
  });

  it('omits success_callback and the redirects when none are given', async () => {
    const send = answering(201, purchaseJson);

    await clientWith(send).createPurchase({ ...input, successCallback: undefined, redirectUrl: undefined });

    const body = sentBody(send);
    for (const key of ['success_callback', 'success_redirect', 'failure_redirect', 'cancel_redirect']) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("sends an order's lines as products, with the client's phone and the notes, when given them", async () => {
    const send = answering(201, purchaseJson);

    await clientWith(send).createPurchase({
      ...input,
      products: [
        { name: 'Kek coklat moist (2kg)', priceCents: 17000, quantity: 1 },
        { name: 'Tart nenas', priceCents: 2000, quantity: 2 },
        { name: 'Delivery', priceCents: 1000, quantity: 1 },
      ],
      phone: '+60 123456789',
      notes: 'FPX · Maybank2u',
    });

    const body = sentBody(send);
    expect(body.purchase).toEqual({
      currency: 'MYR',
      products: [
        { name: 'Kek coklat moist (2kg)', price: 17000, quantity: '1' },
        { name: 'Tart nenas', price: 2000, quantity: '2' },
        { name: 'Delivery', price: 1000, quantity: '1' },
      ],
      due_strict: true,
    });
    expect(body.client).toEqual({ email: 'owner@example.com', full_name: 'Nadia Bakes', phone: '+60 123456789' });
    expect(body.notes).toBe('FPX · Maybank2u');
  });

  it('offers only the methods it is given, when given some', async () => {
    const send = answering(201, purchaseJson);

    await clientWith(send).createPurchase({ ...input, methods: ['visa', 'razer_tng'] });

    expect(sentBody(send).payment_method_whitelist).toEqual(['visa', 'razer_tng']);
    expect(sentBody(send)).not.toHaveProperty('force_recurring');
  });

  it("reads the brand's name from the issuer details, when CHIP gives one", async () => {
    const named = await clientWith(answering(201, { ...purchaseJson, issuer_details: { brand_name: 'Kek Lina' } })).createPurchase(input);
    expect(named.brandName).toBe('Kek Lina');

    const blank = await clientWith(answering(201, { ...purchaseJson, issuer_details: { brand_name: '' } })).createPurchase(input);
    expect(blank).not.toHaveProperty('brandName');
  });
});

describe('listPaymentMethods', () => {
  it('asks for the brand, MYR and the amount, and returns the method names', async () => {
    const send = answering(200, { available_payment_methods: ['fpx', 'visa', 'razer_tng'], names: {} });

    const methods = await clientWith(send).listPaymentMethods(1000);

    expect(send.mock.calls[0]?.[0]).toBe(`${BASE}/payment_methods/?brand_id=brand-1&currency=MYR&amount=1000`);
    expect(send.mock.calls[0]?.[1].method).toBe('GET');
    expect(send.mock.calls[0]?.[1].headers.authorization).toBe('Bearer secret-key');
    expect(methods).toEqual(['fpx', 'visa', 'razer_tng']);
  });

  it('refuses a list in a shape it does not recognise', async () => {
    await expect(clientWith(answering(200, {})).listPaymentMethods(1000)).rejects.toThrow(/shape/);
    await expect(clientWith(answering(200, { available_payment_methods: [1] })).listPaymentMethods(1000)).rejects.toThrow(/shape/);
  });

  it('throws ChipRefusedError, carrying the status, when the key or brand is refused', async () => {
    const error = await clientWith(answering(401, { detail: 'Invalid token' })).listPaymentMethods(1000).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChipRefusedError);
    expect(error).toMatchObject({ status: 401, name: 'ChipRefusedError' });
  });
});

describe('getPurchase', () => {
  it('narrows a paid purchase', async () => {
    const send = answering(200, paidJson);

    const purchase = await clientWith(send).getPurchase(paidJson.id);

    expect(send.mock.calls[0]?.[0]).toBe(`${BASE}/purchases/${paidJson.id}/`);
    expect(send.mock.calls[0]?.[1].method).toBe('GET');
    expect(purchase).toMatchObject({
      status: 'paid',
      isRecurringToken: true,
      paymentMethod: 'visa',
      maskedPan: '411111******1111',
    });
  });

  it("reads CHIP's generated reference, the notes and the card brand when it sends them", async () => {
    const purchase = await clientWith(
      answering(200, {
        ...paidJson,
        reference_generated: 'CH0042',
        notes: 'FPX · Maybank2u',
        transaction_data: { payment_method: 'mastercard', extra: { masked_pan: '4242', card_brand: 'mastercard' } },
      }),
    ).getPurchase(paidJson.id);
    expect(purchase).toMatchObject({ referenceGenerated: 'CH0042', notes: 'FPX · Maybank2u', paymentMethod: 'mastercard', maskedPan: '4242', currency: 'MYR' });

    const bare = await clientWith(answering(200, { ...purchaseJson, reference_generated: '', notes: '' })).getPurchase('x');
    expect(bare).not.toHaveProperty('referenceGenerated');
    expect(bare).not.toHaveProperty('notes');
  });

  it('accepts an empty reference', async () => {
    const purchase = await clientWith(answering(200, { ...purchaseJson, reference: '' })).getPurchase('x');
    expect(purchase.reference).toBe('');
  });

  it('refuses a purchase in a shape it does not recognise', async () => {
    const broken: Record<string, unknown>[] = [
      { ...purchaseJson, id: 7 },
      { ...purchaseJson, id: undefined },
      { ...purchaseJson, status: undefined },
      { ...purchaseJson, reference: null },
      { ...purchaseJson, purchase: { ...purchaseJson.purchase, total: '4900' } },
      { ...purchaseJson, purchase: undefined },
      { ...purchaseJson, checkout_url: undefined },
      { ...purchaseJson, is_recurring_token: 'false' },
      { ...purchaseJson, is_test: undefined },
    ];
    for (const body of broken) {
      await expect(clientWith(answering(200, body)).getPurchase('x')).rejects.toThrow(/shape/);
    }
    await expect(clientWith(answering(200, 'nope')).getPurchase('x')).rejects.toThrow(/not a purchase/);
    await expect(clientWith(answering(200, null)).getPurchase('x')).rejects.toThrow(/not a purchase/);
  });
});

describe('chargePurchase', () => {
  it('charges with a token: paid / pending_charge', async () => {
    const paid = answering(200, paidJson);
    const result = await clientWith(paid).chargePurchase('p-2', 'token-1');

    expect(paid.mock.calls[0]?.[0]).toBe(`${BASE}/purchases/p-2/charge/`);
    expect(paid.mock.calls[0]?.[1].method).toBe('POST');
    expect(JSON.parse(paid.mock.calls[0]?.[1].body ?? '{}')).toEqual({ recurring_token: 'token-1' });
    expect(result).toMatchObject({ kind: 'paid', purchase: { status: 'paid' } });

    const pending = await clientWith(answering(200, { ...purchaseJson, status: 'pending_charge' })).chargePurchase(
      'p-2',
      'token-1',
    );
    expect(pending).toMatchObject({ kind: 'pending', purchase: { status: 'pending_charge' } });
  });

  it('charge answers invalid-token on 400 invalid_recurring_token', async () => {
    const send = answering(400, {
      __all__: [{ message: 'Invalid or inactive recurring token!', code: 'invalid_recurring_token' }],
    });
    expect(await clientWith(send).chargePurchase('p-2', 'gone')).toEqual({ kind: 'invalid-token' });
  });

  it('charge answers declined on 400 purchase_charge_error', async () => {
    const send = answering(400, { __all__: [{ message: 'Charge failed', code: 'purchase_charge_error' }] });
    expect(await clientWith(send).chargePurchase('p-2', 'token-1')).toEqual({ kind: 'declined' });
  });

  it('throws a plain error on any other 400, and on a charge that is neither paid nor pending', async () => {
    const other = answering(400, { __all__: [{ message: 'Bad', code: 'something_else' }] });
    await expect(clientWith(other).chargePurchase('p-2', 't')).rejects.toThrow(/400/);
    const odd = answering(200, { ...purchaseJson, status: 'created' });
    await expect(clientWith(odd).chargePurchase('p-2', 't')).rejects.toThrow(/created/);
  });
});

describe('deleteRecurringToken, cancelPurchase and getPublicKey', () => {
  it('posts to delete_recurring_token and cancel', async () => {
    const del = answering(200, paidJson);
    await clientWith(del).deleteRecurringToken('p-1');
    expect(del.mock.calls[0]?.[0]).toBe(`${BASE}/purchases/p-1/delete_recurring_token/`);
    expect(del.mock.calls[0]?.[1].method).toBe('POST');

    const cancel = answering(200, purchaseJson);
    await clientWith(cancel).cancelPurchase('p-1');
    expect(cancel.mock.calls[0]?.[0]).toBe(`${BASE}/purchases/p-1/cancel/`);
    expect(cancel.mock.calls[0]?.[1].method).toBe('POST');
  });

  it('reads the public key from its JSON-quoted body', async () => {
    const pem = '-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----\n';
    const send = vi.fn<FetchLike>(async () => new Response(JSON.stringify(pem), { status: 200 }));

    expect(await clientWith(send).getPublicKey()).toBe(pem);
    expect(send.mock.calls[0]?.[0]).toBe(`${BASE}/public_key/`);
    expect(send.mock.calls[0]?.[1].method).toBe('GET');
  });
});

describe('failures', () => {
  it('throws ChipUnavailableError on network failure and 5xx', async () => {
    const down = vi.fn<FetchLike>(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(clientWith(down).getPurchase('x')).rejects.toBeInstanceOf(ChipUnavailableError);
    await expect(clientWith(answering(503, {})).getPurchase('x')).rejects.toMatchObject({
      statusCode: 502,
      code: 'CHIP_UNAVAILABLE',
    });
    await expect(clientWith(answering(500, {})).chargePurchase('x', 't')).rejects.toBeInstanceOf(
      ChipUnavailableError,
    );
  });

  it('passes an abort signal so a hung request cannot hang a payment', async () => {
    const send = answering(200, purchaseJson);
    await clientWith(send, 1234).getPurchase('x');
    expect(send.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('throws a plain error on another 4xx', async () => {
    const error = await clientWith(answering(401, { detail: 'no' })).getPurchase('x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ChipUnavailableError);
    expect((error as Error).message).toMatch(/401/);
  });
});
