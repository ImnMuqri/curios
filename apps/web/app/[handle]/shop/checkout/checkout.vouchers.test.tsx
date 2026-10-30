import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VoucherTerms } from '@curios/core/vouchers';
import { Checkout } from './checkout.js';
import { shopCopy } from '../copy.js';

const copy = shopCopy('en');

const items = [
  { id: 'cake', name: 'Kek coklat moist', slug: 'cake', category: null, tag: null, description: null, photoKey: null, photoUrl: null, priceCents: null, options: [{ id: 'k1', label: '1kg', priceCents: 9500 }] },
];

const base = {
  handle: 'keklina',
  displayName: 'Kek Lina',
  language: 'en',
  items,
  whatsapp: '60123456789' as string | null,
  pickupEnabled: true,
  pickupNote: null as string | null,
  deliveryMode: 'NONE' as const,
  deliveryFeeCents: null as number | null,
  deliveryNote: null as string | null,
  minNoticeDays: 2,
  closedDays: [0],
  now: '2026-10-15T02:00:00.000Z',
};

const voucher = (over: Partial<VoucherTerms>): VoucherTerms => ({
  id: 'v1',
  mode: 'AUTO',
  kind: 'PERCENT',
  percent: 10,
  amountCents: null,
  itemId: null,
  minSpendCents: null,
  label: 'Raya promo',
  ...over,
});
const raya = voucher({});
const insta = (over: Partial<VoucherTerms> = {}) => voucher({ id: 'v2', mode: 'CODE', percent: 15, label: 'INSTA15', ...over });

const KEY = 'curios-basket:keklina';

beforeEach(() => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem(KEY, JSON.stringify([{ itemId: 'cake', optionId: 'k1', quantity: 1 }]));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Route = (url: string, init: RequestInit) => { status: number; body: unknown };
/** A fetch that answers each API path from `route`, and remembers every call. */
function api(route: Route) {
  const spy = vi.fn((url: string, init: RequestInit = {}) => {
    const { status, body } = route(url, init);
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}
const calls = (spy: ReturnType<typeof api>, path: string) => spy.mock.calls.filter(([url]) => String(url).endsWith(path));
const sent = (spy: ReturnType<typeof api>, path: string) => JSON.parse((calls(spy, path)[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;

async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(copy.name), 'Mira Hassan');
  await user.type(screen.getByLabelText(copy.whatsappNumber), '012-987 6543');
  await user.click(screen.getByRole('button', { name: 'Sat 17' }));
}
const placeButton = (total: string) => screen.getByRole('button', { name: copy.placeOrder(total) });
const placed = { number: 1, code: 'ABCD', token: 'tok' };

async function typeCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.click(await screen.findByRole('button', { name: copy.haveACode }));
  await user.type(screen.getByLabelText(copy.haveACode), code);
  await user.click(screen.getByRole('button', { name: copy.applyCode }));
}

describe('Checkout vouchers', () => {
  it('applies the automatic voucher by itself, and places the order at the discounted total', async () => {
    const user = userEvent.setup();
    const spy = api(() => ({ status: 201, body: { ...placed, totalCents: 8550 } }));
    render(<Checkout {...base} vouchers={[raya]} />);
    expect(await screen.findByText('Raya promo −RM9.50')).toBeInTheDocument();
    expect(placeButton('RM85.50')).toBeInTheDocument();
    await fillDetails(user);
    await user.click(placeButton('RM85.50'));
    expect(await screen.findByRole('heading', { name: copy.orderPlaced })).toBeInTheDocument();
    expect(sent(spy, '/store/keklina/orders')).toMatchObject({ seenTotalCents: 8550 });
    expect(sent(spy, '/store/keklina/orders')).not.toHaveProperty('voucherCode');
  });

  it('a typed code is checked, uppercased, and replaces the line when it saves more', async () => {
    const user = userEvent.setup();
    const spy = api((url) =>
      url.endsWith('/vouchers/check') ? { status: 200, body: { voucher: insta() } } : { status: 201, body: { ...placed, totalCents: 8075 } },
    );
    render(<Checkout {...base} vouchers={[raya]} />);
    await typeCode(user, 'insta15');
    expect(await screen.findByText('INSTA15 −RM14.25')).toBeInTheDocument();
    expect(screen.queryByText('Raya promo −RM9.50')).toBeNull();
    expect(sent(spy, '/store/keklina/vouchers/check')).toEqual({ code: 'INSTA15' });
    await fillDetails(user);
    await user.click(placeButton('RM80.75'));
    await screen.findByRole('heading', { name: copy.orderPlaced });
    expect(sent(spy, '/store/keklina/orders')).toMatchObject({ seenTotalCents: 8075, voucherCode: 'INSTA15' });
  });

  it('a code that saves less leaves the better voucher on, and says so', async () => {
    const user = userEvent.setup();
    api(() => ({ status: 200, body: { voucher: insta({ percent: 5 }) } }));
    render(<Checkout {...base} vouchers={[raya]} />);
    await typeCode(user, 'small5');
    expect(await screen.findByText(copy.betterVoucherApplied)).toBeInTheDocument();
    expect(screen.getByText('Raya promo −RM9.50')).toBeInTheDocument();
  });

  it('a refused code says so, and a typed one can be removed', async () => {
    const user = userEvent.setup();
    api((url) =>
      url.endsWith('/vouchers/check')
        ? { status: 404, body: { error: { code: 'VOUCHER_UNKNOWN', message: 'That code doesn\'t work here.' } } }
        : { status: 500, body: {} },
    );
    const { unmount } = render(<Checkout {...base} vouchers={[]} />);
    await typeCode(user, 'nope');
    expect(await screen.findByText(copy.codeUnknown)).toBeInTheDocument();
    expect(screen.queryByText(/−RM/)).toBeNull();
    unmount();

    api(() => ({ status: 200, body: { voucher: insta() } }));
    render(<Checkout {...base} vouchers={[]} />);
    await typeCode(user, 'insta15');
    expect(await screen.findByText('INSTA15 −RM14.25')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.removeCode }));
    expect(screen.queryByText(/INSTA15 −/)).toBeNull();
    expect(placeButton('RM95')).toBeInTheDocument();
  });

  it('a 409 reloads the vouchers: an ended one goes, and the total is the full price', async () => {
    const user = userEvent.setup();
    api(() => ({
      status: 409,
      body: { error: { code: 'PRICES_CHANGED', message: '' }, items: items.map(({ photoUrl: _p, ...i }) => i), vouchers: [] },
    }));
    render(<Checkout {...base} vouchers={[raya]} />);
    await screen.findByText('Raya promo −RM9.50');
    await fillDetails(user);
    await user.click(placeButton('RM85.50'));
    expect(await screen.findByText(copy.pricesChanged)).toBeInTheDocument();
    expect(screen.queryByText(/Raya promo/)).toBeNull();
    expect(placeButton('RM95')).toBeEnabled();
  });

  it('a total of RM0 offers no way to pay, and the placed screen says it is paid', async () => {
    const user = userEvent.setup();
    const spy = api(() => ({ status: 201, body: { ...placed, totalCents: 0 } }));
    render(<Checkout {...base} chipMethods={['fpx', 'visa']} payByQr vouchers={[voucher({ kind: 'AMOUNT', percent: null, amountCents: 9500, label: 'FREEBIE' })]} />);
    expect(await screen.findByText('FREEBIE −RM95')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: copy.howYoullPay })).toBeNull();
    await fillDetails(user);
    await user.click(placeButton('RM0'));
    expect(await screen.findByText(copy.freeOrderPaid)).toBeInTheDocument();
    expect(sent(spy, '/store/keklina/orders')).toMatchObject({ seenTotalCents: 0 });
    expect(calls(spy, '/store/orders/tok/pay')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: /Pay/ })).toBeNull();
    expect(screen.getByRole('link', { name: new RegExp(copy.seeOrder) })).toHaveAttribute('href', '/keklina/order/tok');
  });
});
