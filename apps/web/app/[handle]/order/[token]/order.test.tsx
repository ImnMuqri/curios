import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RECEIPT_MAX_BYTES } from '@curios/core/orders';
import type { PublicOrder } from '@curios/db-read';
import { shopCopy } from '../../shop/copy.js';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ refresh }),
}));
// The settings in force: every switch on, unless a test turns one off.
vi.mock('@curios/db-read', async () => ({ getOrderByToken: vi.fn(), getSettings: vi.fn(async () => (await import('@curios/core/settings')).defaultSettings()) }));

const { getOrderByToken, getSettings } = await import('@curios/db-read');
const { OrderView } = await import('./order-view.js');
const { default: OrderPage, generateMetadata } = await import('./page.js');

const copy = shopCopy('en');

type Props = Parameters<typeof OrderView>[0];

const base: Props = {
  token: 'tok_abc',
  handle: 'keklina',
  displayName: 'Kek Lina',
  language: 'en',
  order: {
    number: 14,
    code: '7Q4M',
    method: 'PICKUP',
    day: '2026-10-17',
    itemsCents: 21500,
    deliveryCents: 0,
    totalCents: 21500,
    status: 'PLACED',
    receiptType: null,
    receiptUploadedAt: null,
    receiptRejectedAt: null,
    paidAt: null,
    refundedAt: null,
    lines: [
      { itemName: 'Kek coklat moist', optionLabel: '2kg', unitPriceCents: 17000, quantity: 1 },
      { itemName: 'Kek batik', optionLabel: null, unitPriceCents: 4500, quantity: 1 },
    ],
  },
  qrUrl: 'https://cdn.test/qr/keklina.png',
  receiptUrl: null,
  bank: { name: 'Maybank', accountName: 'Lina binti Kamal', accountNumber: '1642 3378 9021' },
  whatsapp: '60123456789',
  // Thursday 15 October 2026, 10am in Malaysia.
  now: '2026-10-15T02:00:00.000Z',
};

const withOrder = (patch: Partial<Props['order']>, rest: Partial<Props> = {}): Props => ({
  ...base,
  ...rest,
  order: { ...base.order, ...patch },
});

/** Each step as a screen reader has it: its name, ", done" when lit, and ← on the step being waited on (aria-current). */
const steps = () =>
  within(screen.getByRole('list', { name: copy.orderProgress }))
    .getAllByRole('listitem')
    .map((li) => `${li.textContent}${li.getAttribute('aria-current') === 'step' ? ' ←' : ''}`);

const fileInput = (name: RegExp) => screen.getByLabelText(name);

const ok = () =>
  new Response(JSON.stringify({ receiptUploadedAt: '2026-10-15T03:00:00.000Z' }), { status: 200, headers: { 'content-type': 'application/json' } });

// The clipboard is stubbed in some tests; each test starts from the real one.
const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  refresh.mockReset();
  if (realClipboard) Object.defineProperty(navigator, 'clipboard', realClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('OrderView', () => {
  it("the order page's number and status sit on the background", () => {
    render(<OrderView {...base} />);
    const sheet = screen.getByTestId('sheet');
    const title = screen.getByRole('heading', { level: 1, name: copy.orderTitle(14) });
    expect(sheet).not.toContainElement(title);
    expect(sheet).not.toContainElement(screen.getByText(copy.statusWaiting));
    expect(sheet).not.toContainElement(screen.getByText(copy.bookmark));
    expect(sheet).toContainElement(screen.getByText('7Q4M'));
    expect(sheet).toContainElement(screen.getByRole('heading', { name: copy.yourOrder }));
  });

  it('shows the order, its code and its total', () => {
    render(<OrderView {...base} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Order #14' })).toBeInTheDocument();
    expect(screen.getByText('7Q4M')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.copyCode })).toBeInTheDocument();
    expect(screen.getByText(copy.bookmark)).toBeInTheDocument();
    expect(screen.getByText('Kek Lina')).toBeInTheDocument();
    const order = screen.getByRole('region', { name: copy.yourOrder });
    expect(within(order).getByText('Pickup · Sat 17 Oct')).toBeInTheDocument();
    expect(within(order).getByText('1× Kek coklat moist')).toBeInTheDocument();
    expect(within(order).getByText('2kg')).toBeInTheDocument();
    expect(within(order).getByText('RM170')).toBeInTheDocument();
    expect(within(order).getByText('1× Kek batik')).toBeInTheDocument();
    expect(within(order).getByText('RM45')).toBeInTheDocument();
    expect(within(order).getByText(copy.total).nextSibling).toHaveTextContent('RM215');
  });

  it('adds a flat delivery fee as its own line, so the total adds up', () => {
    render(<OrderView {...withOrder({ method: 'DELIVERY', deliveryCents: 1000, totalCents: 22500 })} />);
    const order = screen.getByRole('region', { name: copy.yourOrder });
    expect(within(order).getByText('Delivery · Sat 17 Oct')).toBeInTheDocument();
    expect(within(order).getByText(copy.deliveryLabel).closest('li')).toHaveTextContent('RM10');
    expect(within(order).getByText(copy.total).nextSibling).toHaveTextContent('RM225');
  });

  it('waiting for payment: the QR (with a download button on its corner), the bank details with Copy, and Upload your receipt', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<OrderView {...base} />);

    expect(screen.getByText('Waiting for payment')).toBeInTheDocument();
    expect(steps()).toEqual(['Placed, done', 'Paid ←', 'Ready', 'Done']);

    const pay = screen.getByRole('region', { name: 'Pay RM215' });
    expect(within(pay).getByText('To Kek Lina, directly')).toBeInTheDocument();
    const qr = within(pay).getByRole('img', { name: 'Kek Lina DuitNow QR' });
    expect(qr).toHaveAttribute('src', 'https://cdn.test/qr/keklina.png');
    expect(qr).toHaveAttribute('referrerpolicy', 'no-referrer');
    // The download button sits inside the QR's own box, on its corner.
    const save = within(pay).getByRole('link', { name: copy.saveQr });
    expect(qr.parentElement).toContainElement(save);
    expect(within(pay).getByText('Maybank · Lina binti Kamal')).toBeInTheDocument();
    expect(within(pay).getByText('1642 3378 9021')).toBeInTheDocument();

    await user.click(within(pay).getByRole('button', { name: copy.copy }));
    expect(writeText).toHaveBeenCalledWith('1642 3378 9021');
    expect(await within(pay).findByRole('button', { name: copy.copied })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: copy.copyCode }));
    expect(writeText).toHaveBeenLastCalledWith('7Q4M');

    expect(within(pay).getByLabelText(new RegExp(copy.uploadReceipt))).toHaveAttribute('type', 'file');
  });

  it('saves the QR from this app’s own address, a plain download link (a cross-origin download attribute is ignored)', () => {
    render(<OrderView {...base} />);
    const save = screen.getByRole('link', { name: copy.saveQr });
    expect(save).toHaveAttribute('href', '/keklina/order/tok_abc/qr');
    expect(save).toHaveAttribute('download');
  });

  it('uploads a receipt, then refreshes the page so its status follows', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchSpy);
    render(<OrderView {...base} />);

    const file = new File(['%PDF-1.4'], 'receipt.pdf', { type: 'application/pdf' });
    await user.upload(fileInput(new RegExp(copy.uploadReceipt)), file);

    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/store\/orders\/tok_abc\/receipt$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ contentType: 'application/pdf', data: btoa('%PDF-1.4') });
  });

  it('says Uploading… aloud, and keeps focus on the box while it sends', async () => {
    const user = userEvent.setup();
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));
    render(<OrderView {...base} />);
    const input = fileInput(new RegExp(copy.uploadReceipt));
    await user.upload(input, new File(['x'], 'r.png', { type: 'image/png' }));

    const status = await screen.findByText(copy.uploading);
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(input).toHaveAttribute('aria-disabled', 'true');
    expect(input).not.toBeDisabled();
    answer(ok());
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('sends a file the picker gave no type by its extension, or else by its first bytes', async () => {
    // A picker that sends an untyped file is not held to the accept list.
    const user = userEvent.setup({ applyAccept: false });
    const fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(ok()));
    vi.stubGlobal('fetch', fetchSpy);
    render(<OrderView {...base} />);
    const input = fileInput(new RegExp(copy.uploadReceipt));

    await user.upload(input, new File(['x'], 'Screenshot.JPG', { type: '' }));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string).contentType).toBe('image/jpeg');

    await vi.waitFor(() => expect(input).not.toHaveAttribute('aria-disabled'));
    // No type and no extension: a PNG's first bytes say what it is.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await user.upload(input, new File([png], 'receipt', { type: '' }));
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(JSON.parse((fetchSpy.mock.calls[1] as [string, RequestInit])[1].body as string).contentType).toBe('image/png');

    // Nothing says it is a picture or a PDF: refused here, as the server would.
    await vi.waitFor(() => expect(input).not.toHaveAttribute('aria-disabled'));
    await user.upload(input, new File(['hello'], 'notes', { type: '' }));
    expect(await screen.findByText(copy.receiptInvalid)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('refuses a receipt over 5 MB before sending it', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<OrderView {...base} />);

    const big = new File(['x'], 'huge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: RECEIPT_MAX_BYTES + 1 });
    await user.upload(screen.getByLabelText(new RegExp(copy.uploadReceipt)), big);

    expect(await screen.findByText(copy.receiptInvalid)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('says what the API refused', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'STORAGE_NOT_CONFIGURED', message: 'x' } }), { status: 503, headers: { 'content-type': 'application/json' } }),
      ),
    );
    render(<OrderView {...base} />);
    await user.upload(screen.getByLabelText(new RegExp(copy.uploadReceipt)), new File(['x'], 'r.png', { type: 'image/png' }));
    expect(await screen.findByText(copy.receiptsOff('Kek Lina'))).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('after upload: Receipt sent, checking', () => {
    render(<OrderView {...withOrder({ receiptUploadedAt: '2026-10-15T03:00:00.000Z', receiptType: 'image/jpeg' }, { receiptUrl: 'https://cdn.test/receipts/p/abc.jpg' })} />);
    expect(screen.getByText('Receipt sent · Kek Lina is checking')).toBeInTheDocument();
    expect(steps()).toEqual(['Placed, done', 'Paid ←', 'Ready', 'Done']);
    const pay = screen.getByRole('region', { name: 'Pay RM215' });
    expect(within(pay).getByRole('link', { name: 'receipt-14.jpg' })).toHaveAttribute('href', 'https://cdn.test/receipts/p/abc.jpg');
    expect(within(pay).getByText(copy.checksIt('Kek Lina'))).toBeInTheDocument();
    expect(within(pay).queryByLabelText(new RegExp(copy.uploadReceipt))).toBeNull();
  });

  it('until it is paid, offers a quiet way to send a different receipt in its place', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchSpy);
    render(<OrderView {...withOrder({ receiptUploadedAt: '2026-10-15T03:00:00.000Z', receiptType: 'image/jpeg' })} />);
    const pay = screen.getByRole('region', { name: 'Pay RM215' });
    await user.upload(within(pay).getByLabelText(copy.uploadDifferent), new File(['x'], 'again.png', { type: 'image/png' }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('not received: asks to pay and upload again', () => {
    render(<OrderView {...withOrder({ receiptRejectedAt: '2026-10-15T04:00:00.000Z' })} />);
    expect(screen.getByText('Waiting for payment')).toBeInTheDocument();
    expect(screen.getByText('Kek Lina didn’t receive your payment. Pay again and upload the new receipt.')).toBeInTheDocument();
    expect(screen.getByLabelText(new RegExp(copy.uploadReceipt))).toBeInTheDocument();
  });

  it('paid: the pay box goes, and Ready lights on the day', () => {
    const paid = withOrder({ status: 'PAID', paidAt: '2026-10-15T03:00:00.000Z', receiptUploadedAt: '2026-10-15T02:30:00.000Z', receiptType: 'image/png' });
    const { unmount } = render(<OrderView {...paid} />);
    expect(screen.getByText('Paid · Kek Lina is getting it ready')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Pay / })).toBeNull();
    expect(steps()).toEqual(['Placed, done', 'Paid, done', 'Ready ←', 'Done']);
    unmount();

    // Saturday 17 October, 9am in Malaysia: the day has come.
    render(<OrderView {...paid} now="2026-10-17T01:00:00.000Z" />);
    // The pill and the step.
    expect(screen.getAllByText('Ready')).toHaveLength(2);
    expect(screen.queryByText('Paid · Kek Lina is getting it ready')).toBeNull();
    expect(steps()).toEqual(['Placed, done', 'Paid, done', 'Ready, done', 'Done ←']);
  });

  it('done: every step lit', () => {
    render(<OrderView {...withOrder({ status: 'COMPLETED', paidAt: '2026-10-15T03:00:00.000Z' })} />);
    expect(steps()).toEqual(['Placed, done', 'Paid, done', 'Ready, done', 'Done, done']);
    expect(screen.getAllByText('Done')).toHaveLength(2);
  });

  it('cancelled, and refunded', () => {
    let view = render(<OrderView {...withOrder({ status: 'CANCELLED' })} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: copy.orderProgress })).toBeNull();
    expect(screen.queryByRole('region', { name: /^Pay / })).toBeNull();
    view.unmount();

    // Cancelled after it was paid, the money not yet back.
    view = render(<OrderView {...withOrder({ status: 'CANCELLED', paidAt: '2026-10-15T03:00:00.000Z' })} />);
    expect(screen.getByText('Cancelled · refund due')).toBeInTheDocument();
    view.unmount();

    render(<OrderView {...withOrder({ status: 'CANCELLED', paidAt: '2026-10-15T03:00:00.000Z', refundedAt: '2026-10-16T03:00:00.000Z' })} />);
    expect(screen.getByText('Refunded')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Pay / })).toBeNull();
  });

  it('WhatsApp <Name> about this order opens a prefilled message naming the order number and code', () => {
    const { unmount } = render(<OrderView {...base} />);
    const link = screen.getByRole('link', { name: 'WhatsApp Kek Lina about this order' });
    const url = new URL(link.getAttribute('href') ?? '');
    expect(url.origin + url.pathname).toBe('https://wa.me/60123456789');
    // The page's URL is the order's key; it never goes on as a referrer.
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const text = url.searchParams.get('text') ?? '';
    expect(text).toContain('#14');
    expect(text).toContain('7Q4M');
    unmount();

    render(<OrderView {...base} whatsapp={null} />);
    expect(screen.queryByRole('link', { name: /WhatsApp/ })).toBeNull();
  });

  // A FLAT fee is always above RM0, so a delivery with none added is a rider's,
  // paid to the rider: said on the delivery line, as checkout says it.
  it('says a rider delivery’s fee is paid separately, on the delivery line, and adds no fee line', () => {
    render(<OrderView {...withOrder({ method: 'DELIVERY', deliveryCents: 0 })} />);
    const order = screen.getByRole('region', { name: copy.yourOrder });
    expect(within(order).getByText('Delivery · Sat 17 Oct · Rider fee paid separately')).toBeInTheDocument();
    expect(within(order).queryByText(copy.deliveryLabel)).toBeNull();
    expect(within(order).getByText(copy.total).nextSibling).toHaveTextContent('RM215');
  });

  it('says nothing about a rider for a pickup or a flat fee', () => {
    render(<OrderView {...withOrder({ method: 'DELIVERY', deliveryCents: 1000, totalCents: 22500 })} />);
    expect(screen.queryByText(/Rider fee/)).toBeNull();
  });

  it('speaks Malay on a Malay page', () => {
    render(<OrderView {...base} language="ms" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Tempahan #14' })).toBeInTheDocument();
    expect(screen.getByText('Menunggu bayaran')).toBeInTheDocument();
  });
});

const order: PublicOrder = {
  id: 'o1',
  number: 14,
  code: '7Q4M',
  customerName: 'Mira',
  phone: '60129876543',
  method: 'PICKUP',
  day: '2026-10-17',
  address: null,
  note: null,
  itemsCents: 21500,
  deliveryCents: 0,
  totalCents: 21500,
  discountCents: 0,
  voucherLabel: null,
  status: 'PLACED',
  receiptKey: 'receipts/p1/abc.jpg',
  receiptType: 'image/jpeg',
  receiptUploadedAt: new Date('2026-10-15T03:00:00.000Z'),
  receiptRejectedAt: null,
  paidAt: null,
  completedAt: null,
  cancelledAt: null,
  refundedAt: null,
  paidVia: null,
  paidMethodLabel: null,
  paidRef: null,
  chipPending: false,
  email: null,
  sentAt: null,
  createdAt: new Date('2026-10-15T02:00:00.000Z'),
  lines: [
    {
      id: 'l1',
      itemName: 'Kek batik',
      optionLabel: null,
      unitPriceCents: 4500,
      quantity: 1,
      photoKey: null,
      kind: 'PHYSICAL',
      delivery: null,
      accessNote: null,
      hasLink: false,
      sessionMinutes: null,
      sessionPlace: null,
      sessionWhere: null,
      sessionStartsAt: null,
      codes: [],
      grants: [],
    },
  ],
  page: {
    handle: 'keklina',
    displayName: 'Kek Lina',
    language: 'en',
    style: 'SOFT',
    accentColor: '#b5294e',
    headingFont: 'JAKARTA',
    avatarKey: null,
    coverKey: null, coverTop: null, coverBottom: null,
    background: 'PAPER',
    backgroundColor: null,
    links: [{ label: 'WA', url: 'https://wa.me/60123456789' }],
    paymentQrKey: 'qr/keklina.png',
    bankName: 'Maybank',
    bankAccountName: 'Lina binti Kamal',
    bankAccountNumber: '1642 3378 9021',
    chipMethods: null,
    suspended: false,
  },
};

const params = (handle: string, token: string) => ({ params: Promise.resolve({ handle, token }) });

describe('OrderView: paid online', () => {
  const paidOnline = withOrder({
    status: 'PAID',
    paidVia: 'CHIP',
    // 3:42pm in Malaysia.
    paidAt: '2026-10-15T07:42:00.000Z',
    paidMethodLabel: 'FPX · Maybank2u',
    paidRef: 'CH0042',
  });
  const status = (body: unknown) =>
    vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

  afterEach(() => {
    window.sessionStorage.clear();
    vi.useRealTimers();
  });

  it('the order page shows Paid after a callback even if the customer never came back', () => {
    const fetch = status({ state: 'pending' });
    vi.stubGlobal('fetch', fetch);
    render(<OrderView {...paidOnline} />);

    expect(screen.getByText(copy.statusPaid('Kek Lina'))).toBeInTheDocument();
    expect(screen.getByText(copy.paidBy('RM215', 'FPX · Maybank2u'))).toBeInTheDocument();
    expect(screen.getByText('15 Oct, 3:42pm · Ref CH0042')).toBeInTheDocument();
    // No QR and no upload once paid, and nothing to check.
    expect(screen.queryByRole('img', { name: 'Kek Lina DuitNow QR' })).toBeNull();
    expect(screen.queryByText(copy.uploadReceipt)).toBeNull();
    expect(screen.queryByRole('heading', { name: copy.paidPlaced })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks a payment in flight, then shows it paid, without the QR meanwhile', async () => {
    const fetch = status({ state: 'paid', paidAt: '2026-10-15T07:42:00.000Z', paidMethodLabel: 'Visa card ending 4242', paidRef: 'purchase-1' });
    vi.stubGlobal('fetch', fetch);
    render(<OrderView {...withOrder({ chipPending: true })} />);

    expect(screen.getByText(copy.checkingPayment)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Kek Lina DuitNow QR' })).toBeNull();
    expect(await screen.findByText(copy.paidBy('RM215', 'Visa card ending 4242'))).toBeInTheDocument();
    expect(String(fetch.mock.calls[0]?.[0])).toMatch(/\/store\/orders\/tok_abc\/pay-status$/);
    expect(screen.getByText(copy.statusPaid('Kek Lina'))).toBeInTheDocument();
    expect(screen.queryByText(copy.checkingPayment)).toBeNull();
  });

  it('says "Paid. Order placed" to a customer coming back from paying, then shows the order', async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem('curios-paying:tok_abc', '1');
    vi.stubGlobal('fetch', status({ state: 'paid', paidAt: '2026-10-15T07:42:00.000Z', paidMethodLabel: 'FPX · Maybank2u', paidRef: 'CH0042' }));
    render(<OrderView {...withOrder({ chipPending: true })} />);

    expect(await screen.findByRole('heading', { name: copy.paidPlaced })).toBeInTheDocument();
    expect(screen.getByText(copy.paidPlacedSub('RM215', 'Kek Lina'))).toBeInTheDocument();
    expect(screen.getByLabelText('Order code 7Q4M')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: copy.seeOrder }));
    expect(screen.getByText(copy.paidBy('RM215', 'FPX · Maybank2u'))).toBeInTheDocument();
    expect(window.sessionStorage.getItem('curios-paying:tok_abc')).toBeNull();
  });

  it('says it is still waiting for the bank after a few checks, and keeps checking', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout'] });
    const fetch = status({ state: 'pending' });
    vi.stubGlobal('fetch', fetch);
    render(<OrderView {...withOrder({ chipPending: true })} />);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(await screen.findByText(copy.stillWaiting)).toBeInTheDocument();
    // Never stranded: the QR and upload sit under the wait, with a word against paying twice.
    expect(screen.getByText(copy.dontPayAgain('Kek Lina'))).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Kek Lina DuitNow QR' })).toBeInTheDocument();
    expect(screen.getByText(copy.uploadReceipt)).toBeInTheDocument();
    const asked = fetch.mock.calls.length;
    expect(asked).toBeGreaterThanOrEqual(4);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch.mock.calls.length).toBeGreaterThan(asked);
  });

  it('when nothing can ask CHIP, the wait comes with the QR and the word against paying twice', async () => {
    vi.stubGlobal('fetch', status({ state: 'unknown' }));
    render(<OrderView {...withOrder({ chipPending: true })} />);

    expect(await screen.findByText(copy.dontPayAgain('Kek Lina'))).toBeInTheDocument();
    expect(screen.getByText(copy.stillWaiting)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Kek Lina DuitNow QR' })).toBeInTheDocument();
  });

  it('a payment that did not go through: the QR and the upload, with a word about it', async () => {
    vi.stubGlobal('fetch', status({ state: 'failed' }));
    render(<OrderView {...withOrder({ chipPending: true })} />);

    expect(await screen.findByText(copy.onlineFailed)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Kek Lina DuitNow QR' })).toBeInTheDocument();
    expect(screen.getByText(copy.uploadReceipt)).toBeInTheDocument();
  });

  it('speaks Malay on a Malay page', () => {
    vi.stubGlobal('fetch', status({ state: 'pending' }));
    const ms = shopCopy('ms');
    render(<OrderView {...{ ...paidOnline, language: 'ms', order: { ...paidOnline.order, paidMethodLabel: 'Visa card ending 4242' } }} />);
    expect(screen.getByText(ms.paidBy('RM215', 'kad Visa berakhir 4242'))).toBeInTheDocument();
    expect(screen.getByText('15 Okt, 15:42 · Ruj CH0042')).toBeInTheDocument();
  });
});

describe('OrderView: trying to pay again', () => {
  const ALL = ['fpx', 'visa', 'mastercard', 'razer_tng', 'razer_grabpay', 'shopee_pay'];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  function api(routes: { payStatus?: unknown; pay?: unknown; payCode?: number; methods?: unknown } = {}) {
    const spy = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/pay-status')) return json(200, routes.payStatus ?? { state: 'failed' });
      if (url.includes('/pay-methods')) return json(200, routes.methods ?? { fpx: true, wallets: ['tng', 'grab', 'spay'], card: true });
      if (url.endsWith('/pay')) return json(routes.payCode ?? 200, routes.pay ?? { url: 'https://gate.chip-in.asia/p/y/?preferred=visa' });
      return json(404, { error: { code: 'NOT_FOUND', message: 'no' } });
    });
    vi.stubGlobal('fetch', spy);
    return spy;
  }
  const retry = () => screen.getByRole('region', { name: copy.tryPayAgain });
  const choices = () =>
    within(within(retry()).getByRole('radiogroup', { name: copy.howYoullPay }))
      .getAllByRole('radio')
      .map((radio) => radio.querySelector('b')?.textContent);
  const chipOnly: Partial<Props> = { qrUrl: null, bank: { name: null, accountName: null, accountNumber: null }, whatsapp: null, chipMethods: ALL };

  afterEach(() => window.sessionStorage.clear());

  it('after a failed payment, offers the online choices again, beside the QR', async () => {
    const user = userEvent.setup();
    const fetch = api();
    const navigate = vi.fn();
    render(<OrderView {...withOrder({ chipPending: true }, { chipMethods: ALL, navigate })} />);

    expect(await screen.findByText(copy.onlineFailed)).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: copy.tryPayAgain })).toBeInTheDocument();
    // Online choices only: the QR is already on the page.
    expect(choices()).toEqual([copy.onlineBanking, copy.eWallet, copy.card]);
    expect(screen.getByRole('img', { name: 'Kek Lina DuitNow QR' })).toBeInTheDocument();

    await user.click(within(retry()).getByRole('radio', { name: new RegExp(copy.card) }));
    const go = within(retry()).getByRole('button', { name: copy.payByCard('RM215') });
    expect(go).toBeDisabled();
    await user.type(within(retry()).getByLabelText(new RegExp(copy.email)), 'mira@example.com');
    await user.click(go);

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('https://gate.chip-in.asia/p/y/?preferred=visa'));
    const call = fetch.mock.calls.find(([url]) => String(url).endsWith('/store/orders/tok_abc/pay'))!;
    expect(call[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(call[1]!.body as string)).toEqual({ method: 'card', email: 'mira@example.com' });
    expect(window.sessionStorage.getItem('curios-paying:tok_abc')).toBe('1');
  });

  it('offers no retry once a receipt is sent, even after a failed payment; with no receipt it does', async () => {
    api();
    const sent = { chipPending: true, receiptUploadedAt: '2026-10-15T03:00:00.000Z', receiptType: 'image/jpeg' };
    const { unmount } = render(<OrderView {...withOrder(sent, { chipMethods: ALL })} />);
    expect(await screen.findByText(copy.onlineFailed)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: copy.tryPayAgain })).toBeNull();
    unmount();
    render(<OrderView {...withOrder({ chipPending: true }, { chipMethods: ALL })} />);
    expect(await screen.findByRole('region', { name: copy.tryPayAgain })).toBeInTheDocument();
  });

  it('sends the bank chosen for FPX', async () => {
    const user = userEvent.setup();
    const fetch = api();
    render(<OrderView {...withOrder({ chipPending: true }, { chipMethods: ALL, navigate: vi.fn() })} />);
    await screen.findByRole('region', { name: copy.tryPayAgain });
    await user.click(within(retry()).getByRole('radio', { name: 'CIMB Clicks' }));
    await user.type(within(retry()).getByLabelText(new RegExp(copy.email)), 'mira@example.com');
    await user.click(within(retry()).getByRole('button', { name: copy.payWith('RM215', 'CIMB Clicks') }));

    await vi.waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/pay'))).toBe(true));
    const call = fetch.mock.calls.find(([url]) => String(url).endsWith('/pay'))!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({ method: 'fpx', bank: 'cimb', email: 'mira@example.com' });
  });

  it('too many tries says so beside the retry, which stays', async () => {
    const user = userEvent.setup();
    api({ pay: { error: { code: 'RATE_LIMITED', message: 'Too many tries just now.' } }, payCode: 429 });
    render(<OrderView {...withOrder({ chipPending: true }, { chipMethods: ALL, navigate: vi.fn() })} />);
    await screen.findByRole('region', { name: copy.tryPayAgain });
    await user.type(within(retry()).getByLabelText(new RegExp(copy.email)), 'mira@example.com');
    await user.click(within(retry()).getByRole('button', { name: copy.payWith('RM215', 'Maybank2u') }));

    expect(await within(retry()).findByText(copy.payTooMany)).toBeInTheDocument();
    expect(within(retry()).getByRole('button', { name: copy.payWith('RM215', 'Maybank2u') })).toBeEnabled();
  });

  it('when online payment is not available after all, says so and keeps the QR', async () => {
    const user = userEvent.setup();
    api({ pay: { url: null } });
    render(<OrderView {...withOrder({ chipPending: true }, { chipMethods: ALL, navigate: vi.fn() })} />);
    await screen.findByRole('region', { name: copy.tryPayAgain });
    await user.type(within(retry()).getByLabelText(new RegExp(copy.email)), 'mira@example.com');
    await user.click(within(retry()).getByRole('button', { name: copy.payWith('RM215', 'Maybank2u') }));

    expect(await screen.findByText(copy.onlineUnavailable)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Kek Lina DuitNow QR' })).toBeInTheDocument();
  });

  it('a payment already made after all reloads the order', async () => {
    const user = userEvent.setup();
    api({ pay: { error: { code: 'ORDER_ALREADY_PAID', message: 'This order is already paid.' } }, payCode: 409 });
    const navigate = vi.fn();
    render(<OrderView {...withOrder({ chipPending: true }, { chipMethods: ALL, navigate })} />);
    await screen.findByRole('region', { name: copy.tryPayAgain });
    await user.type(within(retry()).getByLabelText(new RegExp(copy.email)), 'mira@example.com');
    await user.click(within(retry()).getByRole('button', { name: copy.payWith('RM215', 'Maybank2u') }));

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/keklina/order/tok_abc'));
  });

  it('after checkout was told too many tries, the order page offers the retry', async () => {
    api();
    window.sessionStorage.setItem('curios-retry:tok_abc', '1');
    render(<OrderView {...withOrder({}, { chipMethods: ALL })} />);
    expect(await screen.findByRole('region', { name: copy.tryPayAgain })).toBeInTheDocument();
  });

  it('offers no retry on a shop that takes nothing online, nor before anything failed', () => {
    api({ payStatus: { state: 'pending' } });
    const { unmount } = render(<OrderView {...withOrder({ chipPending: true })} />);
    expect(screen.queryByRole('region', { name: copy.tryPayAgain })).toBeNull();
    unmount();
    render(<OrderView {...withOrder({}, { chipMethods: ALL })} />);
    expect(screen.queryByRole('region', { name: copy.tryPayAgain })).toBeNull();
  });

  it('a shop that only takes payment online, with no WhatsApp, still offers the retry', async () => {
    api();
    render(<OrderView {...withOrder({}, chipOnly)} />);
    expect(await screen.findByRole('region', { name: copy.tryPayAgain })).toBeInTheDocument();
    expect(screen.queryByText(copy.askHowToPay('Kek Lina'))).toBeNull();
  });

  it('and when it cannot take payment online either, says so plainly', async () => {
    api({ methods: { fpx: false, wallets: [], card: false } });
    const { unmount } = render(<OrderView {...withOrder({}, { ...chipOnly, chipMethods: null })} />);
    expect(screen.getByText(copy.cantPayOnline('Kek Lina'))).toBeInTheDocument();
    expect(screen.queryByText(copy.uploadReceipt)).toBeNull();
    unmount();
    // Listed when last checked, but nothing CHIP takes at this total.
    render(<OrderView {...withOrder({}, chipOnly)} />);
    expect(await screen.findByText(copy.cantPayOnline('Kek Lina'))).toBeInTheDocument();
  });

  it('speaks Malay on a Malay page', async () => {
    api();
    const ms = shopCopy('ms');
    render(<OrderView {...withOrder({}, { ...chipOnly, language: 'ms' })} />);
    expect(await screen.findByRole('region', { name: ms.tryPayAgain })).toBeInTheDocument();
    expect(ms.cantPayOnline('Kek Lina')).toBe('Kek Lina tidak dapat menerima bayaran dalam talian buat masa ini. Simpan halaman ini — ia dikemas kini sebaik sahaja anda membayar.');
  });
});

describe('/[handle]/order/[token]', () => {
  beforeEach(() => vi.stubEnv('STORAGE_PUBLIC_URL', 'https://cdn.test'));
  afterEach(() => vi.unstubAllEnvs());

  it('is a 404 for an unknown token', async () => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce(null);
    await expect(OrderPage(params('keklina', 'nope'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('is a 404 when the order belongs to another page', async () => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce(order);
    await expect(OrderPage(params('otherpage', 'tok'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('draws the order in the page’s theme, with its QR, receipt and WhatsApp', async () => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce(order);
    render(await OrderPage(params('KekLina', 'tok')));
    expect(screen.getByRole('heading', { level: 1, name: 'Order #14' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'receipt-14.jpg' })).toHaveAttribute('href', 'https://cdn.test/receipts/p1/abc.jpg');
    expect(screen.getByRole('link', { name: 'WhatsApp Kek Lina about this order' })).toHaveAttribute('href', expect.stringContaining('wa.me/60123456789'));
    expect(screen.getByRole('main').closest('[data-on-accent]')).not.toBeNull();
  });

  it('for a suspended page shows the order and the unavailable line, but nothing to pay with', async () => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce({
      ...order,
      page: { ...order.page, suspended: true, paymentQrKey: null, bankName: null, bankAccountName: null, bankAccountNumber: null, chipMethods: null },
    });
    render(await OrderPage(params('keklina', 'tok')));

    expect(screen.getByRole('heading', { level: 1, name: 'Order #14' })).toBeInTheDocument();
    expect(screen.getByText(/Kek batik/)).toBeInTheDocument();
    expect(screen.getByText('This page is unavailable')).toBeInTheDocument();
    expect(screen.getByText(/taken down for now/)).toBeInTheDocument();
    expect(screen.queryByText(/1642/)).toBeNull();
    expect(screen.queryByText(/Maybank/)).toBeNull();
    expect(screen.queryByRole('link', { name: /save/i })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(document.querySelector('[href$="/qr"]')).toBeNull();
  });

  it('speaks Malay about a suspended Malay page', () => {
    render(<OrderView {...withOrder({}, { language: 'ms', suspended: true })} />);
    expect(screen.getByText('Halaman ini tidak tersedia')).toBeInTheDocument();
    expect(screen.getByText(/Ia diturunkan buat masa ini/)).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('hands the shop’s online methods to the order page, for trying to pay again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ fpx: true, wallets: [], card: false }), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.mocked(getOrderByToken).mockResolvedValueOnce({
      ...order,
      receiptKey: null,
      receiptType: null,
      receiptUploadedAt: null,
      page: { ...order.page, paymentQrKey: null, bankName: null, bankAccountName: null, bankAccountNumber: null, links: [], chipMethods: ['fpx'] },
    });
    render(await OrderPage(params('keklina', 'tok')));
    expect(await screen.findByRole('region', { name: copy.tryPayAgain })).toBeInTheDocument();
  });

  it('offers no online way to try again while CHIP payments are off', async () => {
    const off = (await import('@curios/core/settings')).defaultSettings();
    off.switches.chipPayments = false;
    vi.mocked(getSettings).mockResolvedValueOnce(off);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.mocked(getOrderByToken).mockResolvedValueOnce({
      ...order,
      receiptKey: null,
      receiptType: null,
      receiptUploadedAt: null,
      // CHIP the only way to pay, so the retry would be offered if the switch let it.
      page: { ...order.page, paymentQrKey: null, bankName: null, bankAccountName: null, bankAccountNumber: null, links: [], chipMethods: ['fpx'] },
    });
    render(await OrderPage(params('keklina', 'tok')));
    expect(screen.getByRole('heading', { level: 1, name: 'Order #14' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: copy.tryPayAgain })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('draws an order paid online as paid, from the server, with how and the reference', async () => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce({
      ...order,
      status: 'PAID',
      receiptKey: null,
      receiptType: null,
      receiptUploadedAt: null,
      paidAt: new Date('2026-10-15T07:42:00.000Z'),
      paidVia: 'CHIP',
      paidMethodLabel: 'FPX · Maybank2u',
      paidRef: 'CH0042',
    });
    render(await OrderPage(params('keklina', 'tok')));
    expect(screen.getByText(copy.paidBy('RM215', 'FPX · Maybank2u'))).toBeInTheDocument();
    expect(screen.getByText('15 Oct, 3:42pm · Ref CH0042')).toBeInTheDocument();
  });

  it('is never indexed, and titles the tab', async () => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce(order);
    expect(await generateMetadata(params('keklina', 'tok'))).toEqual({
      title: 'Order #14 · Kek Lina',
      robots: { index: false, follow: false },
      referrer: 'no-referrer',
    });
    vi.mocked(getOrderByToken).mockResolvedValueOnce(null);
    expect(await generateMetadata(params('keklina', 'nope'))).toEqual({ robots: { index: false, follow: false }, referrer: 'no-referrer' });
  });
});

describe('OrderView: a voucher', () => {
  const discounted = withOrder({ itemsCents: 21500, totalCents: 20550, discountCents: 950, voucherLabel: 'RAYA10' });

  it('names the voucher and what it took off, between the lines and the total, and asks for the discounted total', () => {
    render(<OrderView {...discounted} />);
    expect(screen.getByText('RAYA10 −RM9.50')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Pay RM205.50' })).toBeInTheDocument();
    expect(within(screen.getByTestId('sheet')).getAllByText('RM205.50').length).toBeGreaterThan(0);
  });

  it('shows no voucher line for an order with no discount', () => {
    render(<OrderView {...withOrder({ discountCents: 0, voucherLabel: null })} />);
    expect(screen.queryByText(/−RM/)).toBeNull();
  });

  const free = withOrder({
    itemsCents: 21500,
    totalCents: 0,
    discountCents: 21500,
    voucherLabel: 'FREE100',
    status: 'PAID',
    paidVia: 'VOUCHER',
    paidAt: '2026-10-15T02:00:00.000Z',
  });

  it('a voucher-paid RM0 order is paid: no QR, bank, receipt box or retry, and it says so', () => {
    render(<OrderView {...free} chipMethods={['fpx']} />);
    expect(screen.getByText(copy.paidWithVoucher)).toBeInTheDocument();
    expect(screen.getByText('FREE100 −RM215')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Pay / })).toBeNull();
    expect(screen.queryByAltText(/QR/i)).toBeNull();
    expect(screen.queryByText(/Maybank/)).toBeNull();
    expect(screen.queryByLabelText(/receipt/i)).toBeNull();
    expect(screen.queryByText(/pay again/i)).toBeNull();
    expect(screen.getByText('Paid · Kek Lina is getting it ready')).toBeInTheDocument();
    expect(steps()).toEqual(['Placed, done', 'Paid, done', 'Ready ←', 'Done']);
  });

  it('a cancelled voucher-paid order reads plainly Cancelled, with no refund due', () => {
    render(<OrderView {...withOrder({ ...free.order, status: 'CANCELLED' })} />);
    expect(screen.getByText(copy.statusCancelled)).toBeInTheDocument();
    expect(screen.queryByText(copy.statusRefundDue)).toBeNull();
  });

  it('a voucher-paid digital order reads Sent once it is sent', () => {
    render(<OrderView {...withOrder({ ...free.order, method: null, day: null, sentAt: '2026-10-15T02:01:00.000Z', email: 'a@b.my' })} />);
    expect(screen.getByText('Paid · Sent to your email')).toBeInTheDocument();
    expect(steps()).toEqual(['Placed, done', 'Paid, done', 'Sent, done']);
  });

  it('speaks Malay on a Malay page', () => {
    render(<OrderView {...free} language="ms" />);
    expect(screen.getByText(shopCopy('ms').paidWithVoucher)).toBeInTheDocument();
    expect(shopCopy('ms').paidWithVoucher).not.toBe(copy.paidWithVoucher);
  });

  it('the page hands the voucher to the view', async () => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce({ ...order, totalCents: 20550, discountCents: 950, voucherLabel: 'RAYA10' });
    render(await OrderPage(params('keklina', 'tok')));
    expect(screen.getByText('RAYA10 −RM9.50')).toBeInTheDocument();
  });
});
