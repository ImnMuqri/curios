import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkout, newPlaceKey } from './checkout.js';
import { attachReceipt } from './receipt-test-helper.js';
import { shopCopy } from '../copy.js';

/** Paying by the owner's own QR or bank: pay first, attach the receipt, and the order is sent with it. */

const copy = shopCopy('en');
const ms = shopCopy('ms');

const items = [{ id: 'batik', name: 'Kek batik', slug: 'batik', category: null, tag: null, description: null, photoKey: null, photoUrl: null, priceCents: 4500, options: [] }];

const base = {
  handle: 'keklina',
  displayName: 'Kek Lina',
  language: 'en',
  items,
  whatsapp: '60123456789' as string | null,
  pickupEnabled: true,
  pickupPlaces: [],
  deliveryMode: 'FLAT' as const,
  deliveryFeeCents: 1000 as number | null,
  deliveryNote: null,
  minNoticeDays: 2,
  closedDays: [0],
  // Thursday 15 October 2026, 10am in Malaysia.
  now: '2026-10-15T02:00:00.000Z',
  payByQr: true,
  hasQr: true,
  qrUrl: 'https://cdn.test/qr/kek.png',
  bank: { name: 'Maybank', accountName: 'Lina Binti Ali', accountNumber: '5123 4567 8901' },
};

const KEY = 'curios-basket:keklina';
const placed = { number: 12, code: '7Q4M', token: 'tok_abc', totalCents: 4500, receipt: true };

beforeEach(() => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem(KEY, JSON.stringify([{ itemId: 'batik', optionId: null, quantity: 1 }]));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function api(order: () => Response | Promise<Response>) {
  const spy = vi.fn(async (url: string) => {
    if (url.includes('/pay-methods')) return json(200, { fpx: true, wallets: [], card: true });
    if (url.endsWith('/orders')) return order();
    return json(404, { error: { code: 'NOT_FOUND', message: 'no' } });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}
const orderBody = (spy: ReturnType<typeof api>, n = 0) =>
  JSON.parse((spy.mock.calls.filter(([url]) => String(url).endsWith('/orders'))[n] as unknown as [string, RequestInit])[1].body as string) as Record<string, unknown>;

async function fill(user: ReturnType<typeof userEvent.setup>, c = copy) {
  await user.type(screen.getByLabelText(c.name), 'Mira Hassan');
  await user.type(screen.getByLabelText(c.whatsappNumber), '012-987 6543');
  await user.click(screen.getByRole('button', { name: c.dayPill('2026-10-17') }));
}
const send = (total = 'RM45') => screen.getByRole('button', { name: copy.sendOrder(total) });

describe('Checkout, paying first by the shop’s QR', () => {
  it('shows the owner’s QR, their bank account and the exact total, with a receipt box, right under How you’ll pay', async () => {
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    const section = screen.getByRole('heading', { name: copy.howYoullPay }).closest('section') as HTMLElement;
    expect(within(section).getByText(copy.qrPayAmount('RM45'))).toBeInTheDocument();
    // The same box the order page draws: QR, then the account to transfer to, with its copy button.
    expect(within(section).getByRole('img', { name: copy.qrLabel('Kek Lina') })).toHaveAttribute('src', 'https://cdn.test/qr/kek.png');
    expect(within(section).getByText(copy.scanOrTransfer)).toBeInTheDocument();
    expect(within(section).getByText('Maybank · Lina Binti Ali')).toBeInTheDocument();
    expect(within(section).getByText('5123 4567 8901')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: copy.copy })).toBeInTheDocument();
    expect(within(section).getByLabelText(new RegExp(copy.attachReceipt))).toHaveAttribute('type', 'file');
    // The total is the final one: delivery and everything.
  });

  it('shows the final total, delivery included', async () => {
    const user = userEvent.setup();
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await user.click(screen.getByRole('radio', { name: /Delivery/ }));
    expect(screen.getByText(copy.qrPayAmount('RM55'))).toBeInTheDocument();
    expect(send('RM55')).toBeInTheDocument();
  });

  it('says Send order, in Malay too, and says why it waits', async () => {
    const user = userEvent.setup();
    render(<Checkout {...base} language="ms" />);
    await screen.findByText('Kek batik');
    await fill(user, ms);
    const button = screen.getByRole('button', { name: ms.sendOrder('RM45') });
    expect(button).toHaveTextContent('Hantar tempahan · RM45');
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(ms.receiptNeeded);
    expect(screen.queryByRole('button', { name: /Buat tempahan/ })).toBeNull();
    await attachReceipt(user, 'resit.jpg', 'ms');
    expect(button).toBeEnabled();
    expect(screen.getByText('resit.jpg')).toBeInTheDocument();
    expect(screen.getByText(ms.receiptAttached)).toBeInTheDocument();
  });

  it('takes the receipt files the order page takes, and says why when one is not', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    const input = screen.getByLabelText(new RegExp(copy.attachReceipt));

    await user.upload(input, new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.receiptInvalid);
    expect(send()).toBeDisabled();

    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' });
    await user.upload(input, big);
    expect(screen.getByRole('alert')).toHaveTextContent(copy.receiptInvalid);
    expect(send()).toBeDisabled();

    // A PDF and a picture with no type (some Android pickers) are fine.
    await user.upload(input, new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'bank.pdf', { type: 'application/pdf' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(send()).toBeEnabled();
  });

  it('sends the order with the receipt in the one request, and ends on Order sent, with nothing left to pay', async () => {
    const user = userEvent.setup();
    const spy = api(() => json(201, placed));
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());

    expect(spy.mock.calls.filter(([url]) => String(url).endsWith('/orders'))).toHaveLength(1);
    // The same bytes the file held, as base64: the first four are the JPEG signature.
    const { receipt, seenTotalCents } = orderBody(spy) as { receipt: { contentType: string; data: string }; seenTotalCents: number };
    expect(seenTotalCents).toBe(4500);
    expect(receipt.contentType).toBe('image/jpeg');
    expect(atob(receipt.data).charCodeAt(0)).toBe(0xff);
    // No separate upload, and no CHIP.
    expect(spy.mock.calls.some(([url]) => String(url).includes('/receipt') || String(url).endsWith('/pay'))).toBe(false);

    expect(await screen.findByRole('heading', { name: copy.orderSent })).toHaveFocus();
    expect(screen.getByText(copy.orderSentSub('Kek Lina'))).toBeInTheDocument();
    expect(screen.queryByText(copy.orderPlaced)).toBeNull();
    expect(screen.queryByText(copy.placedSub('Kek Lina'))).toBeNull();
    expect(screen.getByLabelText('Order code 7Q4M')).toHaveTextContent('7Q4M');
    expect(screen.getByRole('link', { name: copy.seeOrder })).toHaveAttribute('href', '/keklina/order/tok_abc');
    expect(screen.queryByRole('link', { name: /Pay RM/ })).toBeNull();
    expect(screen.queryByText(copy.holdNote)).toBeNull();
    expect(screen.getByRole('link', { name: copy.whatsappShop('Kek Lina') })).toBeInTheDocument();
  });

  it('says Order sent in Malay', async () => {
    const user = userEvent.setup();
    api(() => json(201, placed));
    render(<Checkout {...base} language="ms" />);
    await screen.findByText('Kek batik');
    await fill(user, ms);
    await attachReceipt(user, 'resit.jpg', 'ms');
    await user.click(screen.getByRole('button', { name: ms.sendOrder('RM45') }));
    expect(await screen.findByRole('heading', { name: 'Tempahan dihantar' })).toBeInTheDocument();
    expect(screen.getByText('Kek Lina akan menyemak resit anda dan mengesahkan.')).toBeInTheDocument();
  });

  it('drops the receipt when the total changes (basket, delivery), and says the new amount to attach it for', async () => {
    const user = userEvent.setup();
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    expect(send()).toBeEnabled();

    await user.click(screen.getByRole('button', { name: copy.oneMore }));
    expect(screen.queryByText('receipt.jpg')).toBeNull();
    expect(screen.getByText(copy.receiptTotalChanged('RM90'))).toBeInTheDocument();
    expect(send('RM90')).toBeDisabled();
    expect(screen.getByLabelText(new RegExp(copy.attachReceipt))).toBeInTheDocument();

    await attachReceipt(user);
    expect(screen.queryByText(copy.receiptTotalChanged('RM90'))).toBeNull();
    expect(send('RM90')).toBeEnabled();
  });

  it('asks for no receipt on a card or bank way, and keeps their buttons', async () => {
    const user = userEvent.setup();
    api(() => json(201, placed));
    render(<Checkout {...base} chipMethods={['fpx', 'visa']} />);
    await screen.findByText('Kek batik');
    await fill(user);
    // The first way is online banking: no QR, no receipt box, the pay button as before.
    expect(screen.queryByLabelText(new RegExp(copy.attachReceipt))).toBeNull();
    expect(screen.queryByText(copy.qrPayAmount('RM45'))).toBeNull();
    expect(screen.getByRole('button', { name: /^Pay RM45/ })).toBeInTheDocument();

    await user.click(within(screen.getByRole('radiogroup', { name: copy.howYoullPay })).getByRole('radio', { name: new RegExp(copy.duitnowQr) }));
    expect(screen.getByLabelText(new RegExp(copy.attachReceipt))).toBeInTheDocument();
    expect(send()).toBeDisabled();
    await user.click(within(screen.getByRole('radiogroup', { name: copy.howYoullPay })).getByRole('radio', { name: new RegExp(`^${copy.card}`) }));
    expect(screen.queryByLabelText(new RegExp(copy.attachReceipt))).toBeNull();
  });

  it('sends no receipt on an online way, even after one was attached on the QR way', async () => {
    const user = userEvent.setup();
    const spy = api(() => json(201, placed));
    render(<Checkout {...base} chipMethods={['fpx', 'visa']} navigate={vi.fn()} />);
    await screen.findByText('Kek batik');
    await fill(user);
    const group = () => within(screen.getByRole('radiogroup', { name: copy.howYoullPay }));
    await user.click(group().getByRole('radio', { name: new RegExp(copy.duitnowQr) }));
    await attachReceipt(user);
    await user.click(group().getByRole('radio', { name: new RegExp(`^${copy.card}`) }));
    await user.type(screen.getByLabelText(new RegExp(copy.email)), 'mira@example.com');
    await user.click(screen.getByRole('button', { name: copy.payByCard('RM45') }));
    await vi.waitFor(() => expect(spy.mock.calls.some(([url]) => String(url).endsWith('/orders'))).toBe(true));
    expect(orderBody(spy)).not.toHaveProperty('receipt');
  });

  it('a refusal after they paid: names the problem, says not to pay again and who to send the receipt to, keeps the file, and a retry sends it', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const spy = api(() => (calls++ === 0 ? json(409, { error: { code: 'ITEM_UNAVAILABLE', message: 'Kek batik isn’t available any more.' } }) : json(201, placed)));
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user, 'bukti.jpg');
    await user.click(send());

    expect(await screen.findByRole('alert')).toHaveTextContent('Kek batik isn’t available any more.');
    expect(screen.getByText(copy.paidNotSent('Kek Lina'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.whatsappAbout('Kek Lina') })).toHaveAttribute('href', expect.stringContaining('wa.me/60123456789'));
    // Kept in the form, so the retry needs nothing more.
    expect(screen.getByText('bukti.jpg')).toBeInTheDocument();
    expect(send()).toBeEnabled();
    expect(screen.queryByRole('heading', { name: copy.orderSent })).toBeNull();

    await user.click(send());
    expect(await screen.findByRole('heading', { name: copy.orderSent })).toBeInTheDocument();
    expect(orderBody(spy, 1)).toHaveProperty('receipt');
  });

  it('a network failure says the same, and without a WhatsApp number points at the page’s links', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/orders')) throw new TypeError('Failed to fetch');
        return json(404, {});
      }),
    );
    render(<Checkout {...base} whatsapp={null} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // No answer: it may have gone through, so it does not say it was not sent.
    expect(screen.getByText(copy.paidMaybeSent('Kek Lina'))).toBeInTheDocument();
    expect(screen.queryByText(copy.paidNotSent('Kek Lina'))).toBeNull();
    expect(screen.getByText(copy.paidContactLinks('Kek Lina'))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: copy.whatsappAbout('Kek Lina') })).toBeNull();
    expect(screen.getByText('receipt.jpg')).toBeInTheDocument();
  });

  it('a rate limit says so, and the same notice follows', async () => {
    const user = userEvent.setup();
    api(() => json(429, { error: { code: 'RATE_LIMITED', message: 'Too many orders just now. Try again later.' } }));
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many orders just now. Try again later.');
    expect(screen.getByText(copy.paidNotSent('Kek Lina'))).toBeInTheDocument();
    expect(send()).toBeEnabled();
  });

  it('a price that changed after they paid keeps the receipt and the amount they paid, and does not offer to send it for the new total', async () => {
    const user = userEvent.setup();
    api(() =>
      json(409, {
        error: { code: 'PRICES_CHANGED', message: '' },
        items: [{ ...items[0], priceCents: 5000, photoUrl: undefined }],
      }),
    );
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());

    expect(await screen.findByText(copy.paidPricesChanged('Kek Lina', 'RM45'))).toBeInTheDocument();
    expect(screen.getByText('receipt.jpg')).toBeInTheDocument();
    expect(send('RM50')).toBeDisabled();
  });

  it('a shop paused under them says so and still points the receipt at the shop', async () => {
    const user = userEvent.setup();
    api(() => json(403, { error: { code: 'ORDERS_PAUSED', message: 'Paused.' } }));
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());
    expect(await screen.findByText(copy.paused('Kek Lina'))).toBeInTheDocument();
    expect(screen.getByText(copy.paidNotSent('Kek Lina'))).toBeInTheDocument();
  });

  it('a free order has no QR, no receipt box and its plain button', async () => {
    render(
      <Checkout
        {...base}
        vouchers={[{ id: 'v', mode: 'AUTO', kind: 'PERCENT', percent: 100, amountCents: null, itemId: null, minSpendCents: null, label: 'FREE' }]}
      />,
    );
    await screen.findByText('Kek batik');
    expect(screen.queryByLabelText(new RegExp(copy.attachReceipt))).toBeNull();
    expect(screen.getByRole('button', { name: copy.placeOrder('RM0') })).toBeInTheDocument();
  });
});

describe('Checkout, paying first: one attempt, one key', () => {
  const keys = (spy: ReturnType<typeof api>) =>
    spy.mock.calls.filter(([url]) => String(url).endsWith('/orders')).map((_, n) => orderBody(spy, n).placeKey as string);

  it('a retry after a lost answer sends the same key, so the API makes one order', async () => {
    const user = userEvent.setup();
    let calls = 0;
    const spy = vi.fn(async (url: string) => {
      if (url.includes('/pay-methods')) return json(200, { fpx: true, wallets: [], card: true });
      if (calls++ === 0) throw new TypeError('Failed to fetch');
      return json(201, placed);
    });
    vi.stubGlobal('fetch', spy);
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());

    // It may have gone through: the screen says so, that sending again is safe, and keeps Send order for the retry.
    expect(await screen.findByText(copy.paidMaybeSent('Kek Lina'))).toBeInTheDocument();
    expect(send()).toBeEnabled();
    await user.click(send());
    expect(await screen.findByRole('heading', { name: copy.orderSent })).toBeInTheDocument();
    const [first, second] = keys(spy);
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(second).toBe(first);
  });

  it('a 502 is as unsure as no answer', async () => {
    const user = userEvent.setup();
    api(() => json(502, { error: { code: 'BAD_GATEWAY', message: 'Bad gateway' } }));
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());
    expect(await screen.findByText(copy.paidMaybeSent('Kek Lina'))).toBeInTheDocument();
  });

  it('a change to the order makes a new key', async () => {
    const user = userEvent.setup();
    const spy = api(() => json(409, { error: { code: 'ITEM_UNAVAILABLE', message: 'Gone.' } }));
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());
    await screen.findByText(copy.paidNotSent('Kek Lina'));
    // Same order again: same key.
    await user.click(send());
    await vi.waitFor(() => expect(keys(spy)).toHaveLength(2));
    expect(keys(spy)[1]).toBe(keys(spy)[0]);

    // A different address, name or basket is a different order.
    await user.clear(screen.getByLabelText(copy.name));
    await user.type(screen.getByLabelText(copy.name), 'Mira H');
    await user.click(send());
    await vi.waitFor(() => expect(keys(spy)).toHaveLength(3));
    expect(keys(spy)[2]).not.toBe(keys(spy)[0]);
  });

  it('a placed order ends the attempt: the next order has its own key', async () => {
    const user = userEvent.setup();
    const spy = api(() => json(201, placed));
    const first = render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());
    await screen.findByRole('heading', { name: copy.orderSent });
    first.unmount();

    window.sessionStorage.setItem(KEY, JSON.stringify([{ itemId: 'batik', optionId: null, quantity: 1 }]));
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());
    await vi.waitFor(() => expect(keys(spy)).toHaveLength(2));
    expect(keys(spy)[1]).not.toBe(keys(spy)[0]);
  });

  it('the basket changing after a refusal drops the receipt and says why, as before paying', async () => {
    const user = userEvent.setup();
    api(() => json(409, { error: { code: 'ITEM_UNAVAILABLE', message: 'Gone.' } }));
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());
    await screen.findByText(copy.paidNotSent('Kek Lina'));
    expect(screen.getByText('receipt.jpg')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: copy.oneMore }));
    expect(screen.queryByText('receipt.jpg')).toBeNull();
    expect(screen.getByText(copy.receiptTotalChanged('RM90'))).toBeInTheDocument();
    // The notice said the file was still attached: it goes with the file.
    expect(screen.queryByText(copy.paidNotSent('Kek Lina'))).toBeNull();
    expect(send('RM90')).toBeDisabled();
  });

  it('holds the receipt box while the order is being sent', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (String(url).includes('/pay-methods') ? json(200, { fpx: true, wallets: [], card: true }) : new Promise<Response>(() => {}))),
    );
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());
    expect(screen.getByLabelText(copy.uploadDifferent)).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Checkout, paying first: hardening', () => {
  it('says Order sent only when the API says the order holds the receipt; an older API that did not is the paid-but-not-sent path', async () => {
    const user = userEvent.setup();
    // An API from before receipts rode with the order: it made an order awaiting payment and said nothing of a receipt.
    api(() => json(201, { number: 12, code: '7Q4M', token: 'tok_abc', totalCents: 4500 }));
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());

    expect(await screen.findByText(copy.paidNotSent('Kek Lina'))).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: copy.orderSent })).toBeNull();
    expect(screen.queryByRole('heading', { name: copy.orderPlaced })).toBeNull();
    // The receipt stays and the basket is kept, so nothing is lost.
    expect(screen.getByText('receipt.jpg')).toBeInTheDocument();
    expect(screen.getByText('Kek batik')).toBeInTheDocument();
  });

  it('receipts switched off on the server is a definite "not sent, send it to the shop", not "may have gone through"', async () => {
    const user = userEvent.setup();
    api(() => json(503, { error: { code: 'STORAGE_NOT_CONFIGURED', message: 'Pictures are switched off here.' } }));
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());

    expect(await screen.findByText(copy.paidNotSentContact('Kek Lina'))).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(copy.receiptsOff('Kek Lina'));
    expect(screen.queryByText(copy.paidMaybeSent('Kek Lina'))).toBeNull();
    expect(screen.getByRole('link', { name: copy.whatsappAbout('Kek Lina') })).toBeInTheDocument();
  });

  it('a 503 that is only the server being down is still unsure', async () => {
    const user = userEvent.setup();
    api(() => json(503, { error: { code: 'UNAVAILABLE', message: 'Down.' } }));
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fill(user);
    await attachReceipt(user);
    await user.click(send());
    expect(await screen.findByText(copy.paidMaybeSent('Kek Lina'))).toBeInTheDocument();
  });

  it('makes the key from the browser’s secure random source when randomUUID is missing, never Math.random', () => {
    const random = vi.spyOn(Math, 'random');
    const bytes = vi.fn((array: Uint8Array) => {
      array.forEach((_, i) => (array[i] = i * 17));
      return array;
    });
    vi.stubGlobal('crypto', { getRandomValues: bytes });
    const key = newPlaceKey();
    expect(bytes).toHaveBeenCalledTimes(1);
    expect(random).not.toHaveBeenCalled();
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).toBe('00112233445566778899aabbccddeeff');
  });
});
