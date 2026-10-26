import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PHYSICAL_FACTS, type DigitalFacts } from '@curios/core/digital';
import type { ShopItem } from '@curios/db-read';
import { Checkout } from './checkout.js';
import { shopCopy } from '../copy.js';

const en = shopCopy('en');
const ms = shopCopy('ms');

const SESSION_AT = '2026-11-07T12:00:00.000Z'; // Sat 7 Nov, 8:00pm in Malaysia
type Row = ShopItem & Partial<DigitalFacts> & { photoUrl: string | null };
const shelf = (over: Pick<Row, 'id' | 'name' | 'slug' | 'priceCents'> & Partial<Row>): Row => ({ category: null, tag: null, description: null, photoKey: null, photoUrl: null, options: [], ...over });
const items = [
  shelf({ ...PHYSICAL_FACTS, id: 'cake', name: 'Kek batik', slug: 'cake', priceCents: 4500 }),
  shelf({ ...PHYSICAL_FACTS, kind: 'DIGITAL', delivery: 'FILES', format: { kinds: ['PDF'], count: 2 }, id: 'ebook', name: 'Recipe e-book', slug: 'ebook', priceCents: 2500 }),
  shelf({
    ...PHYSICAL_FACTS,
    kind: 'DIGITAL',
    delivery: 'SESSION',
    minutes: 90,
    place: 'ONLINE',
    sessions: [{ id: 'time1', startsAt: SESSION_AT, seatsLeft: 3 }],
    id: 'class',
    name: 'Online class',
    slug: 'class',
    priceCents: 6000,
  }),
  shelf({ ...PHYSICAL_FACTS, kind: 'DIGITAL', delivery: 'CODES', soldOut: true, id: 'voucher', name: 'Voucher', slug: 'voucher', priceCents: 5000 }),
];

const base = {
  handle: 'keklina',
  displayName: 'Kek Lina',
  language: 'en',
  items,
  whatsapp: null as string | null,
  pickupEnabled: true,
  pickupNote: 'Seksyen 7',
  deliveryMode: 'FLAT' as const,
  deliveryFeeCents: 1000,
  deliveryNote: null,
  minNoticeDays: 2,
  closedDays: [0],
  now: '2026-10-15T02:00:00.000Z',
};
const KEY = 'curios-basket:keklina';
const basket = (lines: object[]) => window.sessionStorage.setItem(KEY, JSON.stringify(lines));

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function reply(status: number, body: unknown) {
  const spy = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

async function fillDetails(user: ReturnType<typeof userEvent.setup>, copy = en) {
  await user.type(screen.getByLabelText(copy.name), 'Mira Hassan');
  await user.type(screen.getByLabelText(copy.whatsappNumber), '012-987 6543');
}

describe('Checkout with digital items', () => {
  it('digital-only: no Getting it choice, no Day, no fee; says it comes by email', async () => {
    basket([{ itemId: 'ebook', optionId: null, quantity: 1 }, { itemId: 'class', optionId: null, quantity: 1, sessionId: 'time1' }]);
    render(<Checkout {...base} />);
    expect(await screen.findByText(copy('ebook'))).toBeInTheDocument();
    expect(screen.getByText(en.byEmailRightAfter)).toBeInTheDocument();
    expect(screen.getByText(en.byEmailBody)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: new RegExp(en.pickupLabel) })).toBeNull();
    expect(screen.queryByRole('heading', { name: en.day })).toBeNull();
    // The line says what is in it, and for a class, when.
    const cls = screen.getByText('Online class').closest('li') as HTMLElement;
    expect(within(cls).getByText('Sat 7 Nov, 8:00pm · 90 minutes')).toBeInTheDocument();
    expect(within(screen.getByText('Recipe e-book').closest('li') as HTMLElement).getByText('PDF · 2 files')).toBeInTheDocument();
    // The summary: items, "Digital items · By email", total; nothing about pickup.
    expect(screen.getByText(en.digitalItems)).toBeInTheDocument();
    expect(screen.getByText(en.byEmail)).toBeInTheDocument();
    expect(screen.queryByText(en.pickupOn)).toBeNull();
  });

  it('asks for the email, and holds Place order until it looks right', async () => {
    const user = userEvent.setup();
    basket([{ itemId: 'ebook', optionId: null, quantity: 1 }]);
    render(<Checkout {...base} />);
    await screen.findByText('Recipe e-book');
    await fillDetails(user);
    const place = screen.getByRole('button', { name: en.placeOrder('RM25') });
    expect(screen.getByText(en.emailFor('files'))).toBeInTheDocument();
    expect(place).toBeDisabled();
    await user.type(screen.getByLabelText(new RegExp(en.email)), 'mira@example.com');
    expect(place).toBeEnabled();
  });

  it('places a digital-only order with no method or day, sending the email and the class time', async () => {
    const user = userEvent.setup();
    basket([{ itemId: 'class', optionId: null, quantity: 2, sessionId: 'time1' }]);
    const fetch = reply(201, { number: 3, code: 'ABCD', token: 'tok', totalCents: 12000 });
    render(<Checkout {...base} />);
    await screen.findByText('Online class');
    await fillDetails(user);
    await user.type(screen.getByLabelText(new RegExp(en.email)), 'mira@example.com');
    await user.click(screen.getByRole('button', { name: en.placeOrder('RM120') }));
    const [, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      lines: [{ itemId: 'class', optionId: null, quantity: 2, sessionId: 'time1' }],
      email: 'mira@example.com',
      customerName: 'Mira Hassan',
      phone: '012-987 6543',
      address: null,
      note: null,
      consent: true,
      seenTotalCents: 12000,
    });
    expect(await screen.findByText(en.digitalPlacedNote(false, 'mira@example.com'))).toBeInTheDocument();
  });

  it('mixed: keeps Getting it and Day, says the digital part comes by email, and sends both', async () => {
    const user = userEvent.setup();
    basket([{ itemId: 'cake', optionId: null, quantity: 1 }, { itemId: 'ebook', optionId: null, quantity: 1 }]);
    const fetch = reply(201, { number: 4, code: 'WXYZ', token: 'tok2', totalCents: 7000 });
    render(<Checkout {...base} />);
    await screen.findByText('Kek batik');
    expect(screen.getByText(en.mixedLine)).toBeInTheDocument();
    expect(screen.queryByText(en.byEmailRightAfter)).toBeNull();
    expect(screen.getByRole('heading', { name: en.day })).toBeInTheDocument();
    expect(screen.getByText(en.emailFor('files'))).toBeInTheDocument();
    await fillDetails(user);
    await user.type(screen.getByLabelText(new RegExp(en.email)), 'mira@example.com');
    const place = screen.getByRole('button', { name: en.placeOrder('RM70') });
    // No day yet.
    expect(place).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Sat 17' }));
    await user.click(place);
    const body = JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ method: 'PICKUP', day: '2026-10-17', email: 'mira@example.com' });
  });

  it('refuses to place a basket with a sold-out line, and says so on the line', async () => {
    const user = userEvent.setup();
    basket([{ itemId: 'voucher', optionId: null, quantity: 1 }]);
    render(<Checkout {...base} />);
    const line = (await screen.findByText('Voucher')).closest('li') as HTMLElement;
    expect(within(line).getByText(en.soldOut)).toBeInTheDocument();
    await fillDetails(user);
    await user.type(screen.getByLabelText(new RegExp(en.email)), 'mira@example.com');
    expect(screen.getByRole('button', { name: en.placeOrder('RM50') })).toBeDisabled();
  });

  it('stops a class line with no time, a time that is gone, or too few seats, and links to the item page', async () => {
    const user = userEvent.setup();
    basket([{ itemId: 'class', optionId: null, quantity: 1 }]);
    const { unmount } = render(<Checkout {...base} />);
    const line = (await screen.findByText('Online class')).closest('li') as HTMLElement;
    expect(within(line).getByText(en.pickTimeFirst)).toBeInTheDocument();
    expect(within(line).getByRole('link', { name: en.pickATime })).toHaveAttribute('href', '/keklina/shop/class');
    await fillDetails(user);
    await user.type(screen.getByLabelText(new RegExp(en.email)), 'mira@example.com');
    expect(screen.getByRole('button', { name: en.placeOrder('RM60') })).toBeDisabled();
    unmount();

    window.sessionStorage.clear();
    basket([{ itemId: 'class', optionId: null, quantity: 1, sessionId: 'deleted' }]);
    const again = render(<Checkout {...base} />);
    expect(await screen.findByText(en.pickTimeFirst)).toBeInTheDocument();
    again.unmount();

    window.sessionStorage.clear();
    basket([{ itemId: 'class', optionId: null, quantity: 5, sessionId: 'time1' }]);
    render(<Checkout {...base} />);
    expect(await screen.findByText(en.seatsLeft(3))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en.placeOrder('RM300') })).toBeDisabled();
  });

  it('says the unpaid hold on the placed screen for a code or a seat, in both languages, and not otherwise', async () => {
    const user = userEvent.setup();
    basket([{ itemId: 'class', optionId: null, quantity: 1, sessionId: 'time1' }]);
    reply(201, { number: 7, code: 'HOLD', token: 'tk', totalCents: 6000 });
    render(<Checkout {...base} language="ms" />);
    await screen.findByText('Online class');
    await fillDetails(user, ms);
    await user.type(screen.getByLabelText(new RegExp(ms.email)), 'mira@example.com');
    await user.click(screen.getByRole('button', { name: ms.placeOrder('RM60') }));
    expect(await screen.findByText(ms.holdNote)).toBeInTheDocument();
  });

  it('does not say it for files, which hold nothing', async () => {
    const user = userEvent.setup();
    basket([{ itemId: 'ebook', optionId: null, quantity: 1 }]);
    reply(201, { number: 8, code: 'FILE', token: 'tk2', totalCents: 2500 });
    render(<Checkout {...base} />);
    await screen.findByText('Recipe e-book');
    await fillDetails(user);
    await user.type(screen.getByLabelText(new RegExp(en.email)), 'mira@example.com');
    await user.click(screen.getByRole('button', { name: en.placeOrder('RM25') }));
    expect(await screen.findByText(en.digitalPlacedNote(false, 'mira@example.com'))).toBeInTheDocument();
    expect(screen.queryByText(en.holdNote)).toBeNull();
  });

  it('words the server’s digital refusals in the page’s language, not the API’s English', async () => {
    for (const [code, key] of [['SOLD_OUT', 'SOLD_OUT'], ['TIME_FULL', 'TIME_FULL'], ['TIME_REQUIRED', 'TIME_REQUIRED'], ['INVALID_ORDER', 'INVALID_ORDER']] as const) {
      window.sessionStorage.clear();
      basket([{ itemId: 'class', optionId: null, quantity: 1, sessionId: 'time1' }]);
      reply(409, { error: { code, message: 'ENGLISH FROM THE API' } });
      const user = userEvent.setup();
      const view = render(<Checkout {...base} language="ms" />);
      await screen.findByText('Online class');
      await fillDetails(user, ms);
      await user.type(screen.getByLabelText(new RegExp(ms.email)), 'mira@example.com');
      await user.click(screen.getByRole('button', { name: ms.placeOrder('RM60') }));
      expect(await screen.findByText(ms.digitalError(key)!)).toBeInTheDocument();
      expect(screen.queryByText('ENGLISH FROM THE API')).toBeNull();
      view.unmount();
    }
    expect(ms.digitalError('INVALID_ORDER')).toBe('Bakul anda telah berubah. Muat semula halaman dan cuba lagi.');
    expect(en.digitalError('INVALID_ORDER')).toBe('Your basket changed. Reload the page and try again.');
    expect(en.digitalError('EMAIL_REQUIRED')).toMatch(/email/);
    expect(ms.digitalError('EMAIL_REQUIRED')).toMatch(/e-mel/);
  });

  it('reads in Malay on a Malay page', async () => {
    basket([{ itemId: 'class', optionId: null, quantity: 1, sessionId: 'time1' }]);
    render(<Checkout {...base} language="ms" />);
    expect(await screen.findByText(ms.byEmailRightAfter)).toBeInTheDocument();
    expect(screen.getByText(ms.digitalItems)).toBeInTheDocument();
    expect(screen.getByText('Sab 7 Nov, 20:00 · 90 minit')).toBeInTheDocument();
    expect(screen.getByText(ms.emailFor('session'))).toBeInTheDocument();
  });

  it('does not ask for an email a second time to pay online: the one given is CHIP’s', async () => {
    const user = userEvent.setup();
    basket([{ itemId: 'ebook', optionId: null, quantity: 1 }]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('pay-methods')
          ? new Response(JSON.stringify({ fpx: true, wallets: [], card: false }), { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response(JSON.stringify({ number: 5, code: 'QQQQ', token: 'tok3', totalCents: 2500, url: 'https://pay.test/x' }), { status: 201, headers: { 'content-type': 'application/json' } }),
      ),
    );
    const navigate = vi.fn();
    render(<Checkout {...base} chipMethods={['fpx']} payByQr={false} navigate={navigate} />);
    await screen.findByText('Recipe e-book');
    await fillDetails(user);
    // One email field only: checkout's own.
    expect(screen.getAllByLabelText(new RegExp(en.email))).toHaveLength(1);
    expect(screen.queryByText(en.forReceipt)).toBeNull();
    await user.type(screen.getByLabelText(new RegExp(en.email)), 'mira@example.com');
    await user.click(screen.getByRole('button', { name: en.payWith('RM25', 'Maybank2u') }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('https://pay.test/x'));
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    const pay = calls.find(([url]) => String(url).endsWith('/pay'))!;
    expect(JSON.parse(pay[1].body as string)).toMatchObject({ email: 'mira@example.com' });
  });
});

/** The name of the file item's line, for a first wait. */
function copy(id: string) {
  return items.find((i) => i.id === id)!.name;
}
