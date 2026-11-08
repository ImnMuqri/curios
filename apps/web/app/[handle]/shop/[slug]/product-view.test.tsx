import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductView } from './product-view.js';
import { defaultStorageKey, readBasket, writeBasket } from '../basket.js';

const cake = {
  id: 'cake',
  name: 'Kek Coklat Moist',
  slug: 'kek-coklat-moist',
  category: 'Kek',
  tag: 'Best seller',
  description: 'Rich and moist, with a ganache top.',
  photoKey: 'x.webp',
  photoUrl: 'https://cdn.test/x.webp',
  priceCents: null,
  options: [
    { id: 'k1', label: '1kg', priceCents: 9500 },
    { id: 'k2', label: '2kg', priceCents: 17000 },
  ],
};
const cookie = { ...cake, id: 'cookie', name: 'Cookies', slug: 'cookies', tag: null, description: null, photoKey: null, photoUrl: null, priceCents: 2500, options: [] };

const base = {
  handle: 'keklina',
  displayName: 'Kek Lina',
  language: 'en',
  item: cake,
  items: [cake, cookie],
  halal: false,
  noticeDays: 2,
  nextDay: '2026-10-17' as string | null,
  pickup: true,
  onDone: vi.fn(),
};

const key = defaultStorageKey('keklina');
beforeEach(() => {
  window.sessionStorage.clear();
  base.onDone.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('ProductView', () => {
  it('shows the photo, tag, name, price and description', () => {
    const { container } = render(<ProductView {...base} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/x.webp');
    expect(screen.getByText('Best seller')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Kek Coklat Moist' })).toBeInTheDocument();
    expect(screen.getByTestId('price')).toHaveTextContent('RM95');
    expect(screen.getByText('Rich and moist, with a ganache top.')).toBeInTheDocument();
  });

  it('shows an initial when there is no photo, and no tag or sizes that are not there', () => {
    const { container } = render(<ProductView {...base} item={cookie} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.queryByText('Best seller')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByTestId('price')).toHaveTextContent('RM25');
  });

  it('has a top bar: back to the shop, the shop’s name, the basket with its count', () => {
    writeBasket(key, [
      { itemId: 'cookie', optionId: null, quantity: 2 },
      { itemId: 'gone', optionId: null, quantity: 5 },
    ]);
    render(<ProductView {...base} />);
    expect(screen.getByRole('link', { name: 'Back to the shop' })).toHaveAttribute('href', '/keklina/shop');
    expect(screen.getByText('Kek Lina’s shop')).toBeInTheDocument();
    const basket = screen.getByRole('link', { name: 'Basket' });
    expect(basket).toHaveAttribute('href', '/keklina/shop/checkout');
    expect(basket).toHaveTextContent('2');
  });

  it('shows no count on an empty basket', () => {
    render(<ProductView {...base} />);
    expect(screen.getByRole('link', { name: 'Basket' })).toHaveTextContent('');
  });

  it('changes the price with the chosen size card', async () => {
    const user = userEvent.setup();
    render(<ProductView {...base} />);
    expect(screen.getByRole('radio', { name: /1kg/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: /2kg/ }));
    expect(screen.getByRole('radio', { name: /2kg/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('price')).toHaveTextContent('RM170');
    expect(screen.getByRole('button', { name: 'Add to basket · RM170' })).toBeInTheDocument();
  });

  it('says how much notice it needs and the earliest day', () => {
    render(<ProductView {...base} />);
    expect(screen.getByText('Needs 2 days. Earliest pickup Sat 17 Oct.')).toBeInTheDocument();
  });

  it('says delivery for a shop that only delivers, and drops what it cannot promise', () => {
    const { rerender } = render(<ProductView {...base} pickup={false} />);
    expect(screen.getByText('Needs 2 days. Earliest delivery Sat 17 Oct.')).toBeInTheDocument();
    rerender(<ProductView {...base} nextDay={null} />);
    expect(screen.getByText('Needs 2 days.')).toBeInTheDocument();
    rerender(<ProductView {...base} noticeDays={0} />);
    expect(screen.getByText('Earliest pickup Sat 17 Oct.')).toBeInTheDocument();
    rerender(<ProductView {...base} noticeDays={0} nextDay={null} />);
    expect(screen.queryByText(/Earliest|Needs/)).toBeNull();
  });

  it('says halal only when the shop does', () => {
    const { rerender } = render(<ProductView {...base} />);
    expect(screen.queryByText(/Halal/)).toBeNull();
    rerender(<ProductView {...base} halal />);
    expect(screen.getByText('Halal ingredients.')).toBeInTheDocument();
  });

  it('sends "Ask about this" to the page’s Ask tab with the question typed in', () => {
    render(<ProductView {...base} />);
    const ask = screen.getByRole('link', { name: /Ask about this/ });
    const href = ask.getAttribute('href') ?? '';
    expect(href.startsWith('/keklina?q=')).toBe(true);
    expect(href.endsWith('#ask')).toBe(true);
    expect(new URL(href, 'https://x.test').searchParams.get('q')).toBe('I have a question about Kek Coklat Moist.');
    expect(screen.getByText('What’s in it? Is it OK for kids?')).toBeInTheDocument();
  });

  it('steps the quantity, never below one, and prices the button by it', async () => {
    const user = userEvent.setup();
    render(<ProductView {...base} item={cookie} />);
    await user.click(screen.getByRole('button', { name: 'One less' }));
    expect(screen.getByTestId('qty')).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: 'One more' }));
    await user.click(screen.getByRole('button', { name: 'One more' }));
    expect(screen.getByTestId('qty')).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Add to basket · RM75' })).toBeInTheDocument();
  });

  it('adds the chosen size and quantity to the shop’s basket, says so, and goes back to the shop', async () => {
    const user = userEvent.setup();
    writeBasket(key, [{ itemId: 'cake', optionId: 'k2', quantity: 1 }]);
    render(<ProductView {...base} />);
    await user.click(screen.getByRole('radio', { name: /2kg/ }));
    await user.click(screen.getByRole('button', { name: 'One more' }));
    await user.click(screen.getByRole('button', { name: 'Add to basket · RM340' }));
    expect(readBasket(key)).toEqual([{ itemId: 'cake', optionId: 'k2', quantity: 3 }]);
    expect(screen.getByRole('status')).toHaveTextContent('Kek Coklat Moist added. 3 in basket.');
    expect(base.onDone).toHaveBeenCalledTimes(1);
    // The page is about to be left, so it leaves the line for the shop to say.
    expect(window.sessionStorage.getItem('curios-added:keklina')).toBe('Kek Coklat Moist added. 3 in basket.');
  });

  it('keeps the arrow keys inside the size cards, one tab stop', async () => {
    const user = userEvent.setup();
    render(<ProductView {...base} />);
    expect(screen.getByRole('radio', { name: /1kg/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: /2kg/ })).toHaveAttribute('tabindex', '-1');
    screen.getByRole('radio', { name: /1kg/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /2kg/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /2kg/ })).toHaveFocus();
  });

  it('hides the initial from a screen reader', () => {
    render(<ProductView {...base} item={cookie} />);
    expect(screen.getByText('C')).toHaveAttribute('aria-hidden', 'true');
  });

  it('adds an item with no sizes with no option', async () => {
    const user = userEvent.setup();
    render(<ProductView {...base} item={cookie} />);
    await user.click(screen.getByRole('button', { name: 'Add to basket · RM25' }));
    expect(readBasket(key)).toEqual([{ itemId: 'cookie', optionId: null, quantity: 1 }]);
  });

  it('speaks Malay on a Malay page', () => {
    render(<ProductView {...base} language="ms" halal />);
    expect(screen.getByRole('link', { name: 'Kembali ke kedai' })).toBeInTheDocument();
    expect(screen.getByText('Kedai Kek Lina')).toBeInTheDocument();
    expect(screen.getByText('Perlu 2 hari. Awal ambil Sab 17 Okt.')).toBeInTheDocument();
    expect(screen.getByText('Bahan halal.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Masuk bakul · RM95' })).toBeInTheDocument();
  });

  it('writes the preview’s own basket and stays put when it is inline', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<ProductView {...base} inline storageKey="curios-store-preview" onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'Add to basket · RM95' }));
    expect(readBasket('curios-store-preview')).toHaveLength(1);
    expect(window.sessionStorage.getItem('curios-added:keklina')).toBeNull();
    expect(readBasket(key)).toHaveLength(0);
    expect(onDone).toHaveBeenCalled();
  });

  it('sends the preview’s back arrow to onDone instead of leaving', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<ProductView {...base} inline onDone={onDone} />);
    await user.click(screen.getByRole('link', { name: 'Back to the shop' }));
    expect(onDone).toHaveBeenCalled();
  });
});

describe('ProductView promotions', () => {
  const v = (over: object) => ({ id: 'v1', mode: 'AUTO' as const, kind: 'AMOUNT' as const, percent: null, amountCents: 500, itemId: 'cookie', minSpendCents: null, label: 'Raya promo', ...over });

  it('says what a one-item voucher takes off this item', () => {
    render(<ProductView {...base} item={cookie} vouchers={[v({})]} />);
    expect(screen.getByText('RM5 off this item')).toBeInTheDocument();
  });

  it('says the minimum spend, and percentages', () => {
    render(<ProductView {...base} item={cookie} vouchers={[v({ kind: 'PERCENT', percent: 10, amountCents: null, minSpendCents: 5000 })]} />);
    expect(screen.getByText('10% off this item · on orders over RM50')).toBeInTheDocument();
  });

  it('speaks Malay, and the minimum is on the order', () => {
    render(<ProductView {...base} language="ms" item={cookie} vouchers={[v({ minSpendCents: 5000 })]} />);
    expect(screen.getByText('Potongan RM5 untuk barang ini · bagi pesanan RM50 ke atas')).toBeInTheDocument();
  });

  it('shows nothing for another item, a whole-order voucher or a code', () => {
    render(<ProductView {...base} item={cookie} vouchers={[v({ itemId: 'cake' }), v({ itemId: null }), v({ mode: 'CODE' })]} />);
    expect(screen.queryByText(/this item/)).toBeNull();
  });
});

describe('ProductView, an Ask item', () => {
  const custom = { ...cake, id: 'custom', name: 'Custom birthday cake', slug: 'custom-birthday-cake', tag: 'Made to order', description: 'Your theme, your colours.', photoKey: null, photoUrl: null, priceCents: 18000, askForPrice: true, options: [] };
  const props = { ...base, item: custom, items: [cake, cookie, custom], onEnquirySent: vi.fn() };
  const api = 'http://localhost:3001';

  function stubFetch(status: number, body: unknown) {
    const spy = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', spy);
    return spy;
  }

  async function fill(user: ReturnType<typeof userEvent.setup>, message = 'For 20 people on Sun 15 Nov. Budget RM250.') {
    if (message) await user.type(screen.getByRole('textbox', { name: 'Your message to Kek Lina' }), message);
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Mira Hassan');
    await user.type(screen.getByRole('textbox', { name: 'Your WhatsApp number' }), '012-345 6789');
  }

  beforeEach(() => props.onEnquirySent.mockClear());
  afterEach(() => vi.unstubAllGlobals());

  it('shows its tag and "From RM180", asks instead of adding, and has no separate "Ask about this" row', () => {
    render(<ProductView {...props} />);
    expect(screen.getByText('Made to order')).toBeInTheDocument();
    expect(screen.getByTestId('price')).toHaveTextContent('From RM180');
    expect(screen.getByRole('button', { name: 'Ask Kek Lina' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add to basket/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'One more' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Ask about this/ })).toBeNull();
  });

  it('says "Price on request" with no starting price', () => {
    render(<ProductView {...props} item={{ ...custom, priceCents: null }} />);
    expect(screen.getByTestId('price')).toHaveTextContent('Price on request');
  });

  it('opens the enquiry sheet: the item, one message box, name and WhatsApp, and focus moves in', async () => {
    const user = userEvent.setup();
    render(<ProductView {...props} />);
    await user.click(screen.getByRole('button', { name: 'Ask Kek Lina' }));
    const dialog = screen.getByRole('dialog', { name: 'Custom birthday cake' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('From RM180 · made to order')).toBeInTheDocument();
    expect(screen.getByText('What do you need?')).toBeInTheDocument();
    const message = screen.getByRole('textbox', { name: 'Your message to Kek Lina' });
    expect(message).toHaveAttribute('placeholder', 'The date you need it, how many people, the design, your budget…');
    expect(message).toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveAttribute('autocomplete', 'name');
    expect(screen.getByRole('textbox', { name: 'Your WhatsApp number' })).toHaveAttribute('autocomplete', 'tel');
    expect(screen.getByRole('button', { name: 'Send enquiry' })).toBeInTheDocument();
    expect(screen.getByText('Kek Lina replies on WhatsApp. You don’t pay anything yet.')).toBeInTheDocument();
  });

  it('closes on Escape and on the backdrop, and gives focus back to the bar', async () => {
    const user = userEvent.setup();
    render(<ProductView {...props} />);
    const bar = screen.getByRole('button', { name: 'Ask Kek Lina' });
    await user.click(bar);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bar).toHaveFocus();
    await user.click(bar);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bar).toHaveFocus();
  });

  it('says what is missing by the field, and sends nothing', async () => {
    const spy = stubFetch(201, { conversationId: 'c1' });
    const user = userEvent.setup();
    render(<ProductView {...props} />);
    await user.click(screen.getByRole('button', { name: 'Ask Kek Lina' }));
    await user.click(screen.getByRole('button', { name: 'Send enquiry' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Tell them what you need.');
    expect(screen.getByRole('textbox', { name: 'Your message to Kek Lina' })).toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByRole('textbox', { name: 'Your message to Kek Lina' }), 'A cake');
    await user.click(screen.getByRole('button', { name: 'Send enquiry' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add your name.');
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveFocus();
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Mira');
    await user.click(screen.getByRole('button', { name: 'Send enquiry' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add your WhatsApp number.');
    expect(spy).not.toHaveBeenCalled();
  });

  it('sends the enquiry, hands it to the chat and goes there', async () => {
    const spy = stubFetch(201, { conversationId: 'c-enq' });
    const user = userEvent.setup();
    render(<ProductView {...props} />);
    await user.click(screen.getByRole('button', { name: 'Ask Kek Lina' }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send enquiry' }));
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${api}/enquiries/keklina`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ itemId: 'custom', message: 'For 20 people on Sun 15 Nov. Budget RM250.', name: 'Mira Hassan', phone: '012-345 6789', consent: true });
    expect(props.onEnquirySent).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.sessionStorage.getItem('curios-enquiry:keklina') ?? 'null')).toEqual({
      conversationId: 'c-enq',
      item: { name: 'Custom birthday cake', photoUrl: null },
      text: 'For 20 people on Sun 15 Nov. Budget RM250.',
    });
  });

  it('shows the API’s own words for a 400, and the page’s for a refusal', async () => {
    const user = userEvent.setup();
    stubFetch(400, { error: { code: 'INVALID_PHONE', message: 'Use a Malaysian mobile number, like 012-345 6789.' } });
    render(<ProductView {...props} />);
    await user.click(screen.getByRole('button', { name: 'Ask Kek Lina' }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send enquiry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Use a Malaysian mobile number, like 012-345 6789.');
    expect(screen.getByRole('textbox', { name: 'Your WhatsApp number' })).toHaveAttribute('aria-invalid', 'true');
    expect(props.onEnquirySent).not.toHaveBeenCalled();

    stubFetch(409, { error: { code: 'ALREADY_ENQUIRED', message: 'x' } });
    await user.click(screen.getByRole('button', { name: 'Send enquiry' }));
    expect(await screen.findByText('You already sent an enquiry about this today. The shop will reply on WhatsApp.')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('curios-enquiry:keklina')).toBeNull();
  });

  it('says it failed when the request never lands', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const user = userEvent.setup();
    render(<ProductView {...props} />);
    await user.click(screen.getByRole('button', { name: 'Ask Kek Lina' }));
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Send enquiry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That didn’t send. Try again.');
  });

  it('sends nothing from the Store preview', async () => {
    const spy = stubFetch(201, { conversationId: 'c1' });
    const user = userEvent.setup();
    render(<ProductView {...props} inline storageKey="curios-store-preview" />);
    await user.click(screen.getByRole('button', { name: 'Ask Kek Lina' }));
    await fill(user);
    expect(screen.getByRole('button', { name: 'Send enquiry' })).toBeDisabled();
    expect(screen.getByText('This is a preview. Customers send their enquiry from here.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Your WhatsApp number' }), '{Enter}');
    expect(spy).not.toHaveBeenCalled();
    expect(props.onEnquirySent).not.toHaveBeenCalled();
  });

  it('opens the page’s chat with a question about it when the shop cannot take enquiries', () => {
    render(<ProductView {...props} canEnquire={false} />);
    const link = screen.getByRole('link', { name: 'Ask Kek Lina' });
    expect(new URL(link.getAttribute('href') ?? '', 'https://x.test').searchParams.get('q')).toBe('I have a question about Custom birthday cake.');
    expect(link.getAttribute('href')?.endsWith('#ask')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Ask Kek Lina' })).toBeNull();
  });

  it('never counts an Ask item a stored basket holds', () => {
    writeBasket(key, [{ itemId: 'custom', optionId: null, quantity: 2 }, { itemId: 'cookie', optionId: null, quantity: 1 }]);
    render(<ProductView {...props} />);
    expect(screen.getByRole('link', { name: 'Basket' })).toHaveTextContent('1');
  });

  it('speaks Malay', async () => {
    const user = userEvent.setup();
    render(<ProductView {...props} language="ms" />);
    expect(screen.getByTestId('price')).toHaveTextContent('Dari RM180');
    await user.click(screen.getByRole('button', { name: 'Tanya Kek Lina' }));
    expect(screen.getByText('Dari RM180 · dibuat ikut tempahan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hantar pertanyaan' })).toBeInTheDocument();
    expect(screen.getByText('Kek Lina akan balas di WhatsApp. Anda belum perlu bayar apa-apa.')).toBeInTheDocument();
  });
});
