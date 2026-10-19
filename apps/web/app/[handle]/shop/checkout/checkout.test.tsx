import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkout } from './checkout.js';
import { shopCopy } from '../copy.js';

const copy = shopCopy('en');

const items = [
  { id: 'cake', name: 'Kek coklat moist', description: null, photoKey: null, photoUrl: null, priceCents: null, options: [{ id: 'k1', label: '1kg', priceCents: 9500 }, { id: 'k2', label: '2kg', priceCents: 17000 }] },
  { id: 'batik', name: 'Kek batik', description: null, photoKey: 'items/b.webp', photoUrl: 'https://cdn.test/items/b.webp', priceCents: 4500, options: [] },
];

const base = {
  handle: 'keklina',
  displayName: 'Kek Lina',
  language: 'en',
  items,
  whatsapp: '60123456789' as string | null,
  pickupEnabled: true,
  pickupNote: 'Seksyen 7, Shah Alam · 10am to 6pm' as string | null,
  deliveryMode: 'FLAT' as 'NONE' | 'FLAT' | 'RIDER',
  deliveryFeeCents: 1000 as number | null,
  deliveryNote: 'Around Shah Alam · 2pm to 6pm' as string | null,
  minNoticeDays: 2,
  closedDays: [0],
  // Thursday 15 October 2026, 10am in Malaysia.
  now: '2026-10-15T02:00:00.000Z',
};

const KEY = 'curios-basket:keklina';
const saved = () => JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null') as unknown;

beforeEach(() => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem(
    KEY,
    JSON.stringify([
      { itemId: 'cake', optionId: 'k2', quantity: 1 },
      { itemId: 'batik', optionId: null, quantity: 1 },
    ]),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function reply(status: number, body: unknown) {
  const spy = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(copy.name), 'Mira Hassan');
  await user.type(screen.getByLabelText(copy.whatsappNumber), '012-987 6543');
  await user.click(screen.getByRole('button', { name: 'Sat 17' }));
}

const placeButton = (total: string) => screen.getByRole('button', { name: copy.placeOrder(total) });

describe('Checkout', () => {
  it('lists the basket with steppers and the total', async () => {
    const user = userEvent.setup();
    render(<Checkout {...base} />);
    const cake = (await screen.findByText('Kek coklat moist')).closest('li') as HTMLElement;
    expect(within(cake).getByText('2kg · RM170 each')).toBeInTheDocument();
    expect(within(cake).getByText('RM170')).toBeInTheDocument();
    const batik = screen.getByText('Kek batik').closest('li') as HTMLElement;
    expect(within(batik).getByText('RM45 each')).toBeInTheDocument();
    expect(placeButton('RM215')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.addMore })).toHaveAttribute('href', '/keklina/shop');

    await user.click(within(cake).getByRole('button', { name: copy.oneMore }));
    expect(within(cake).getByText('RM340')).toBeInTheDocument();
    expect(placeButton('RM385')).toBeInTheDocument();

    // At 1, one less takes the line away, as the board's minus does.
    await user.click(within(batik).getByRole('button', { name: copy.oneLess }));
    expect(screen.queryByText('Kek batik')).toBeNull();
    expect(placeButton('RM340')).toBeInTheDocument();
    expect(saved()).toEqual([{ itemId: 'cake', optionId: 'k2', quantity: 2 }]);
  });

  it('stops a line at 99', async () => {
    window.sessionStorage.setItem(KEY, JSON.stringify([{ itemId: 'batik', optionId: null, quantity: 99 }]));
    render(<Checkout {...base} />);
    const batik = (await screen.findByText('Kek batik')).closest('li') as HTMLElement;
    expect(within(batik).getByRole('button', { name: copy.oneMore })).toBeDisabled();
  });

  it('says the basket is empty, with the way back to the shop', async () => {
    window.sessionStorage.clear();
    render(<Checkout {...base} />);
    expect(await screen.findByText(copy.emptyBasket)).toBeInTheDocument();
    // The arrow at the top and the card's own button.
    const back = screen.getAllByRole('link', { name: copy.backToShop });
    expect(back).toHaveLength(2);
    for (const link of back) expect(link).toHaveAttribute('href', '/keklina/shop');
    expect(screen.queryByRole('button', { name: /Place order/ })).toBeNull();
  });

  it('shows pickup and delivery as the shop offers them, with their notes and the fee', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Checkout {...base} />);
    const pickup = await screen.findByRole('radio', { name: /Pickup/ });
    expect(pickup).toHaveAttribute('aria-checked', 'true');
    expect(within(pickup).getByText('Seksyen 7, Shah Alam · 10am to 6pm')).toBeInTheDocument();
    expect(within(pickup).getByText(copy.free)).toBeInTheDocument();
    const delivery = screen.getByRole('radio', { name: /Delivery/ });
    expect(within(delivery).getByText('Around Shah Alam · 2pm to 6pm')).toBeInTheDocument();
    expect(within(delivery).getByText('RM10')).toBeInTheDocument();
    expect(screen.queryByLabelText(copy.address)).toBeNull();

    await user.click(delivery);
    expect(delivery).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText(copy.address)).toBeInTheDocument();
    expect(placeButton('RM225')).toBeInTheDocument();
    unmount();

    // A rider is paid by the customer: no fee is added, and no pickup when it is off.
    render(<Checkout {...base} pickupEnabled={false} deliveryMode="RIDER" deliveryFeeCents={null} />);
    expect(screen.queryByRole('radio', { name: /Pickup/ })).toBeNull();
    const rider = await screen.findByRole('radio', { name: /Delivery/ });
    expect(rider).toHaveAttribute('aria-checked', 'true');
    expect(within(rider).getByText(copy.riderFee)).toBeInTheDocument();
    expect(placeButton('RM215')).toBeInTheDocument();
  });

  it('offers only open days, with the notice and closed days said', async () => {
    const { unmount } = render(<Checkout {...base} />);
    expect(await screen.findByText('2 days’ notice · closed Sundays')).toBeInTheDocument();
    // Thu 15 is today and Fri 16 is inside the notice; Sun 18 is closed.
    expect(screen.queryByRole('button', { name: 'Thu 15' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fri 16' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sun 18' })).toBeNull();
    const days = within(screen.getByRole('group', { name: copy.day })).getAllByRole('button').map((b) => b.textContent);
    expect(days.slice(0, 4)).toEqual(['Sat 17', 'Mon 19', 'Tue 20', 'Wed 21']);
    unmount();

    render(<Checkout {...base} minNoticeDays={1} closedDays={[]} />);
    expect(await screen.findByText('1 day’s notice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fri 16' })).toBeInTheDocument();
  });

  it('holds Place order until name, phone, a day and (for delivery) the address are in', async () => {
    const user = userEvent.setup();
    render(<Checkout {...base} />);
    await screen.findByText('Kek coklat moist');
    expect(placeButton('RM215')).toBeDisabled();
    await user.type(screen.getByLabelText(copy.name), 'Mira Hassan');
    expect(placeButton('RM215')).toBeDisabled();
    await user.type(screen.getByLabelText(copy.whatsappNumber), '012-987 6543');
    expect(placeButton('RM215')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Sat 17' }));
    expect(screen.getByRole('button', { name: 'Sat 17' })).toHaveAttribute('aria-pressed', 'true');
    expect(placeButton('RM215')).toBeEnabled();

    await user.click(screen.getByRole('radio', { name: /Delivery/ }));
    expect(placeButton('RM225')).toBeDisabled();
    await user.type(screen.getByLabelText(copy.address), '12 Jalan Mawar, Seksyen 7');
    expect(placeButton('RM225')).toBeEnabled();
  });

  it('sends what the visitor saw and shows the placed screen with the code', async () => {
    const user = userEvent.setup();
    const fetch = reply(201, { number: 12, code: '7Q4M', token: 'tok_abc', totalCents: 21500 });
    render(<Checkout {...base} />);
    await screen.findByText('Kek coklat moist');
    await fillDetails(user);
    await user.type(screen.getByLabelText(new RegExp(copy.noteFor('Kek Lina'))), 'Less sweet');
    await user.click(placeButton('RM215'));

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/store\/keklina\/orders$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      lines: [
        { itemId: 'cake', optionId: 'k2', quantity: 1 },
        { itemId: 'batik', optionId: null, quantity: 1 },
      ],
      method: 'PICKUP',
      day: '2026-10-17',
      customerName: 'Mira Hassan',
      phone: '012-987 6543',
      address: null,
      note: 'Less sweet',
      consent: true,
      seenTotalCents: 21500,
    });

    // Focus moves to the new screen's heading, so a screen reader hears it arrive.
    expect(await screen.findByRole('heading', { name: copy.orderPlaced })).toHaveFocus();
    expect(screen.getByText(copy.placedSub('Kek Lina'))).toBeInTheDocument();
    expect(screen.getByLabelText('Order code 7Q4M')).toHaveTextContent('7Q4M');
    expect(screen.getByRole('button', { name: copy.copyCode })).toBeInTheDocument();
    expect(screen.getByText(/where is my order 7Q4M\?/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.payNow('RM215') })).toHaveAttribute('href', '/keklina/order/tok_abc');
    const send = screen.getByRole('link', { name: copy.sendLink }).getAttribute('href') ?? '';
    expect(send).toBe(`https://wa.me/60129876543?text=${encodeURIComponent(`${window.location.origin}/keklina/order/tok_abc`)}`);
    expect(saved()).toEqual([]);
  });

  it('puts the drawn +60 on a number typed without its 0', async () => {
    const user = userEvent.setup();
    const fetch = reply(201, { number: 4, code: 'WXYZ', token: 't', totalCents: 21500 });
    render(<Checkout {...base} />);
    await screen.findByText('Kek coklat moist');
    await user.type(screen.getByLabelText(copy.name), 'Mira');
    await user.type(screen.getByLabelText(copy.whatsappNumber), '12-987 6543');
    await user.click(screen.getByRole('button', { name: 'Sat 17' }));
    await user.click(placeButton('RM215'));
    expect(JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string)).toMatchObject({ phone: '+6012-987 6543' });
    expect((await screen.findByRole('link', { name: copy.sendLink })).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/60129876543\?text=/);
  });

  it('copies the code', async () => {
    const user = userEvent.setup();
    reply(201, { number: 12, code: '7Q4M', token: 'tok_abc', totalCents: 21500 });
    render(<Checkout {...base} />);
    await screen.findByText('Kek coklat moist');
    await fillDetails(user);
    await user.click(placeButton('RM215'));
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(await screen.findByRole('button', { name: copy.copyCode }));
    expect(writeText).toHaveBeenCalledWith('7Q4M');
    expect(await screen.findByRole('button', { name: copy.copied })).toBeInTheDocument();
  });

  it('sends a delivery with its address', async () => {
    const user = userEvent.setup();
    const fetch = reply(201, { number: 3, code: 'ABCD', token: 't', totalCents: 22500 });
    render(<Checkout {...base} />);
    await screen.findByText('Kek coklat moist');
    await fillDetails(user);
    await user.click(screen.getByRole('radio', { name: /Delivery/ }));
    await user.type(screen.getByLabelText(copy.address), '12 Jalan Mawar');
    await user.click(placeButton('RM225'));
    const body = JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ method: 'DELIVERY', address: '12 Jalan Mawar', note: null, seenTotalCents: 22500 });
    expect(await screen.findByRole('link', { name: copy.payNow('RM225') })).toBeInTheDocument();
  });

  it('reloads the basket when prices changed, saying so', async () => {
    const user = userEvent.setup();
    reply(409, {
      error: { code: 'PRICES_CHANGED', message: 'Prices changed since you opened the shop. Check your basket and try again.' },
      items: [
        { id: 'cake', name: 'Kek coklat moist', description: null, photoKey: null, priceCents: null, options: [{ id: 'k1', label: '1kg', priceCents: 9500 }, { id: 'k2', label: '2kg', priceCents: 18000 }] },
        { id: 'batik', name: 'Kek batik', description: null, photoKey: 'items/b.webp', priceCents: 4500, options: [] },
      ],
    });
    render(<Checkout {...base} />);
    await screen.findByText('Kek coklat moist');
    await fillDetails(user);
    await user.click(placeButton('RM215'));
    expect(await screen.findByText(copy.pricesChanged)).toBeInTheDocument();
    const cake = screen.getByText('Kek coklat moist').closest('li') as HTMLElement;
    expect(within(cake).getByText('2kg · RM180 each')).toBeInTheDocument();
    expect(placeButton('RM225')).toBeEnabled();
    // The photo it had is kept: the shelf hands back keys, not URLs.
    expect(screen.getByText('Kek batik').closest('li')?.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/items/b.webp');
    expect(screen.queryByRole('heading', { name: copy.orderPlaced })).toBeNull();
  });

  it('reloads the delivery fee when it changed', async () => {
    const user = userEvent.setup();
    const shelf = items.map(({ photoUrl: _photoUrl, ...item }) => item);
    const fetch = reply(409, {
      error: { code: 'PRICES_CHANGED', message: 'Prices changed since you opened the shop. Check your basket and try again.' },
      items: shelf,
      delivery: { mode: 'FLAT', feeCents: 1500 },
    });
    const { unmount } = render(<Checkout {...base} />);
    await screen.findByText('Kek coklat moist');
    await fillDetails(user);
    await user.click(screen.getByRole('radio', { name: /Delivery/ }));
    await user.type(screen.getByLabelText(copy.address), '12 Jalan Mawar');
    await user.click(placeButton('RM225'));
    expect(await screen.findByText(copy.pricesChanged)).toBeInTheDocument();
    expect(within(screen.getByRole('radio', { name: /Delivery/ })).getByText('RM15')).toBeInTheDocument();
    // The retry sends the total the shop now asks for.
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ number: 2, code: 'ABCD', token: 't', totalCents: 23000 }), { status: 201 }));
    await user.click(placeButton('RM230'));
    expect(JSON.parse((fetch.mock.calls[1] as [string, RequestInit])[1].body as string)).toMatchObject({ seenTotalCents: 23000 });
    unmount();

    // Delivery turned off: back to pickup, and saying so.
    window.sessionStorage.setItem(KEY, JSON.stringify([{ itemId: 'batik', optionId: null, quantity: 1 }]));
    reply(409, { error: { code: 'PRICES_CHANGED', message: '' }, items: shelf, delivery: { mode: 'NONE', feeCents: null } });
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    await fillDetails(user);
    await user.click(screen.getByRole('radio', { name: /Delivery/ }));
    await user.type(screen.getByLabelText(copy.address), '12 Jalan Mawar');
    await user.click(placeButton('RM55'));
    expect(await screen.findByText(copy.deliveryOff)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Delivery/ })).toBeNull();
    expect(screen.getByRole('radio', { name: /Pickup/ })).toHaveAttribute('aria-checked', 'true');
    expect(placeButton('RM45')).toBeEnabled();
  });

  it('takes the visitor to the field the shop refused', async () => {
    const user = userEvent.setup();
    const fetch = reply(400, { error: { code: 'INVALID_PHONE', message: 'That number is not a Malaysian mobile.' } });
    render(<Checkout {...base} />);
    await screen.findByText('Kek coklat moist');
    await fillDetails(user);
    await user.click(placeButton('RM215'));
    expect(await screen.findByText('That number is not a Malaysian mobile.')).toBeInTheDocument();
    expect(screen.getByLabelText(copy.whatsappNumber)).toHaveFocus();

    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'ORDER_DATE', message: 'Pick one of the days shown.' } }), { status: 400 }));
    await user.click(placeButton('RM215'));
    expect(await screen.findByText('Pick one of the days shown.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sat 17' })).toHaveFocus();

    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'ITEM_UNAVAILABLE', message: 'Kek batik isn’t available any more.' } }), { status: 409 }));
    await user.click(placeButton('RM215'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kek batik isn’t available any more.');
  });

  it('offers WhatsApp for an order too big to place', async () => {
    const user = userEvent.setup();
    reply(400, { error: { code: 'ORDER_TOO_LARGE', message: 'This order is too big to place here.' } });
    render(<Checkout {...base} />);
    await screen.findByText('Kek coklat moist');
    await fillDetails(user);
    await user.click(placeButton('RM215'));
    expect(await screen.findByText(copy.tooLarge('Kek Lina'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.orderOnWhatsApp }).getAttribute('href')).toMatch(/^https:\/\/wa\.me\/60123456789\?text=/);
    expect(screen.queryByRole('button', { name: /Place order/ })).toBeNull();
  });

  it('falls back to WhatsApp when the shop has just paused', async () => {
    const user = userEvent.setup();
    reply(409, { error: { code: 'ORDERS_PAUSED', message: "This shop isn't taking orders right now." } });
    render(<Checkout {...base} />);
    await screen.findByText('Kek coklat moist');
    await fillDetails(user);
    await user.click(placeButton('RM215'));
    expect(await screen.findByText(copy.paused('Kek Lina'))).toBeInTheDocument();
    const href = screen.getByRole('link', { name: copy.orderOnWhatsApp }).getAttribute('href') ?? '';
    expect(href.startsWith('https://wa.me/60123456789?text=')).toBe(true);
    expect(decodeURIComponent(href.split('?text=')[1] ?? '')).toContain('1 × Kek coklat moist (2kg) — RM170');
    expect(screen.queryByRole('button', { name: /Place order/ })).toBeNull();
  });

  it('shows the phone number’s problem by the field', async () => {
    const user = userEvent.setup();
    reply(400, { error: { code: 'INVALID_PHONE', message: 'That doesn’t look like a Malaysian mobile number.' } });
    render(<Checkout {...base} />);
    await screen.findByText('Kek coklat moist');
    await fillDetails(user);
    await user.click(placeButton('RM215'));
    const message = await screen.findByText('That doesn’t look like a Malaysian mobile number.');
    expect(screen.getByLabelText(copy.whatsappNumber)).toHaveAccessibleDescription(message.textContent ?? '');
  });

  it('speaks Malay on a Malay page', async () => {
    const ms = shopCopy('ms');
    render(<Checkout {...base} language="ms" />);
    expect(await screen.findByRole('heading', { name: ms.checkout })).toBeInTheDocument();
    expect(screen.getByText('Notis 2 hari · tutup hari Ahad')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sab 17' })).toBeInTheDocument();
  });
});
