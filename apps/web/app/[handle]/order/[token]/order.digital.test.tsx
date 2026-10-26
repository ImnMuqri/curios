import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicOrder, PublicOrderLine } from '@curios/db-read';
import { shopCopy } from '../../shop/copy.js';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('@curios/db-read', () => ({ getOrderByToken: vi.fn() }));

const { getOrderByToken } = await import('@curios/db-read');
const { OrderView } = await import('./order-view.js');
const { default: OrderPage } = await import('./page.js');
const { payingKey } = await import('../../shop/checkout/paying.js');

const copy = shopCopy('en');
const ms = shopCopy('ms');
type Props = Parameters<typeof OrderView>[0];
type Line = Props['order']['lines'][number];

const file = (id: string, name: string, usesLeft: number, expiresAt: string, sizeBytes: number | null = 4_400_000) => ({ id, name, sizeBytes, usesLeft, expiresAt });
const FUTURE = '2026-11-14T02:00:00.000Z';
const NOW = '2026-10-15T02:00:00.000Z';

const filesLine = (files = [file('g1', 'recipe.pdf', 5, FUTURE), file('g2', 'ganache.pdf', 2, FUTURE, 1_100_000)]): Line => ({
  itemName: 'Recipe e-book',
  optionLabel: null,
  unitPriceCents: 2500,
  quantity: 1,
  digital: { id: 'l1', name: 'Recipe e-book', delivery: 'FILES', note: null, hasLink: false, minutes: null, place: null, where: null, startsAt: null, codes: [], files },
});
const linkLine: Line = {
  itemName: 'Video course',
  optionLabel: null,
  unitPriceCents: 7900,
  quantity: 1,
  digital: { id: 'l2', name: 'Video course', delivery: 'LINK', note: 'Watch in order.', hasLink: true, minutes: null, place: null, where: null, startsAt: null, codes: [], files: [] },
};
const codesLine: Line = {
  itemName: 'Gift voucher',
  optionLabel: null,
  unitPriceCents: 5000,
  quantity: 2,
  digital: { id: 'l3', name: 'Gift voucher', delivery: 'CODES', note: null, hasLink: false, minutes: null, place: null, where: null, startsAt: null, codes: ['KL50-AAAA', 'KL50-BBBB'], files: [] },
};
const sessionLine: Line = {
  itemName: 'Online class',
  optionLabel: null,
  unitPriceCents: 6000,
  quantity: 1,
  digital: { id: 'l4', name: 'Online class', delivery: 'SESSION', note: null, hasLink: false, minutes: 90, place: 'ONLINE', where: 'https://meet.example/abc', startsAt: '2026-11-07T12:00:00.000Z', codes: [], files: [] },
};

const digital = (patch: Partial<Props['order']> = {}, lines: Line[] = [filesLine()], rest: Partial<Props> = {}): Props => ({
  token: 'tok_abc',
  handle: 'keklina',
  displayName: 'Kek Lina',
  language: 'en',
  order: {
    number: 21,
    code: '7Q4M',
    method: null,
    day: null,
    itemsCents: 2500,
    deliveryCents: 0,
    totalCents: 2500,
    status: 'PAID',
    receiptType: null,
    receiptUploadedAt: null,
    receiptRejectedAt: null,
    paidAt: '2026-10-15T01:00:00.000Z',
    refundedAt: null,
    paidVia: 'CHIP',
    paidMethodLabel: 'FPX',
    paidRef: 'CH1',
    email: 'mira@example.com',
    sentAt: '2026-10-15T01:00:01.000Z',
    lines,
    ...patch,
  },
  qrUrl: null,
  receiptUrl: null,
  bank: { name: null, accountName: null, accountNumber: null },
  whatsapp: null,
  now: NOW,
  ...rest,
});

const steps = () =>
  within(screen.getByRole('list', { name: copy.orderProgress }))
    .getAllByRole('listitem')
    .map((li) => `${li.textContent}${li.getAttribute('aria-current') === 'step' ? ' ←' : ''}`);

afterEach(() => {
  window.sessionStorage.clear();
  vi.mocked(getOrderByToken).mockReset();
});

describe('a digital order before it is paid', () => {
  const unpaid = (kinds: Line[], patch: Partial<Props['order']> = {}) =>
    digital({ status: 'PLACED', paidAt: null, paidVia: null, sentAt: null, ...patch }, kinds.map((l) => ({ ...l, digital: l.digital && { ...l.digital, codes: [], files: [], where: null } })));

  it('shows the locked note, and nothing to download, open or copy', () => {
    render(<OrderView {...unpaid([filesLine(), linkLine, codesLine, sessionLine])} />);
    expect(screen.getByText(copy.dgLockTitle(copy.digWhat(['FILES', 'LINK', 'CODES', 'SESSION'])))).toBeInTheDocument();
    expect(screen.getByText(copy.dgLockPay)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: copy.dgTitle(false) })).toBeNull();
    expect(screen.queryByText(copy.download)).toBeNull();
    expect(screen.queryByText(copy.openLink)).toBeNull();
    expect(screen.queryByText('KL50-AAAA')).toBeNull();
    expect(screen.queryByText('https://meet.example/abc')).toBeNull();
  });

  it('names what is locked when there is one kind', () => {
    render(<OrderView {...unpaid([codesLine])} />);
    expect(screen.getByText('Your code unlock once you’ve paid')).toBeInTheDocument();
  });

  it('says the shop is checking the receipt once one is in', () => {
    render(<OrderView {...unpaid([filesLine()], { status: 'PLACED', receiptUploadedAt: '2026-10-15T01:30:00.000Z', receiptType: 'image/jpeg' })} />);
    expect(screen.getByText(copy.dgLockCheck('Kek Lina'))).toBeInTheDocument();
  });

  it('has no method or day: "By email", and the 3-step timeline still on Placed', () => {
    render(<OrderView {...unpaid([filesLine()])} />);
    expect(steps()).toEqual(['Placed, done', 'Paid ←', 'Sent']);
    expect(within(screen.getByRole('region', { name: copy.yourOrder })).getByText(copy.byEmail)).toBeInTheDocument();
    expect(screen.getByText(copy.statusWaiting)).toBeInTheDocument();
  });
});

describe('a digital order after it is paid', () => {
  it('is Sent: three steps all lit and the pill says so', () => {
    render(<OrderView {...digital()} />);
    expect(steps()).toEqual(['Placed, done', 'Paid, done', 'Sent, done']);
    expect(screen.getByText('Paid · Sent to your email')).toBeInTheDocument();
    expect(screen.queryByText(copy.statusReady)).toBeNull();
  });

  it('paid but not sent yet waits on Sent', () => {
    render(<OrderView {...digital({ sentAt: null }, [filesLine([])])} />);
    expect(steps()).toEqual(['Placed, done', 'Paid, done', 'Sent ←']);
    expect(document.querySelector('[data-tone]')).toHaveTextContent(/^Paid$/);
    expect(screen.getByText(copy.sendingNow)).toBeInTheDocument();
  });

  it('files: a Download per file to the API with the order token, and the uses left', () => {
    render(<OrderView {...digital()} />);
    const section = screen.getByRole('region', { name: 'Your downloads' });
    expect(within(section).getByText('Also sent to mira@example.com')).toBeInTheDocument();
    const links = within(section).getAllByRole('link', { name: copy.download });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'http://localhost:3001/store/orders/tok_abc/files/g1',
      'http://localhost:3001/store/orders/tok_abc/files/g2',
    ]);
    expect(within(section).getByText('4.2 MB · 5 downloads left')).toBeInTheDocument();
    expect(within(section).getByText('1.0 MB · 2 downloads left')).toBeInTheDocument();
    expect(within(section).getByText('Links work until 14 Nov. Lost them? Kek Lina can send new ones.')).toBeInTheDocument();
  });

  it('a used-up file says 0 left and has no button', () => {
    render(<OrderView {...digital({}, [filesLine([file('g1', 'recipe.pdf', 0, FUTURE), file('g2', 'ganache.pdf', 3, FUTURE)])])} />);
    const section = screen.getByRole('region', { name: 'Your downloads' });
    expect(within(section).getByText('4.2 MB · 0 left')).toBeInTheDocument();
    expect(within(section).getAllByRole('link', { name: copy.download })).toHaveLength(1);
    expect(within(section).getByText(copy.linksSomeDead('Kek Lina'))).toBeInTheDocument();
  });

  it('an expired file says so and has no button', () => {
    render(<OrderView {...digital({}, [filesLine([file('g1', 'recipe.pdf', 5, '2026-10-01T00:00:00.000Z')])])} />);
    const section = screen.getByRole('region', { name: 'Your downloads' });
    expect(within(section).getByText('4.2 MB · Expired')).toBeInTheDocument();
    expect(within(section).queryByRole('link', { name: copy.download })).toBeNull();
  });

  it('a link: the note, and a button through the API link route', () => {
    render(<OrderView {...digital({}, [linkLine])} />);
    const section = screen.getByRole('region', { name: copy.dgTitle(false) });
    expect(within(section).getByText(/Watch in order\./)).toHaveTextContent('“Watch in order.” · Kek Lina');
    const open = within(section).getByRole('link', { name: copy.openLink });
    expect(open).toHaveAttribute('href', 'http://localhost:3001/store/orders/tok_abc/link/l2');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(section).getByText(copy.linkPrivate)).toBeInTheDocument();
  });

  it('codes: each given code with its own Copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<OrderView {...digital({}, [codesLine])} />);
    const section = screen.getByRole('region', { name: copy.dgTitle(false) });
    expect(within(section).getByText('KL50-AAAA')).toBeInTheDocument();
    expect(within(section).getByText('KL50-BBBB')).toBeInTheDocument();
    await userEvent.click(within(section).getAllByRole('button', { name: copy.copyShort })[1]!);
    expect(writeText).toHaveBeenCalledWith('KL50-BBBB');
    expect(await within(section).findByText(copy.copied)).toBeInTheDocument();
  });

  it('codes not given yet: the sending note, no code', () => {
    render(<OrderView {...digital({ sentAt: null }, [{ ...codesLine, digital: { ...codesLine.digital!, codes: [] } }])} />);
    expect(screen.getByText(copy.sendingNow)).toBeInTheDocument();
  });

  it('a session: the time, Join, and Add to calendar for that line', () => {
    render(<OrderView {...digital({}, [sessionLine])} />);
    const section = screen.getByRole('region', { name: copy.dgTitle(false) });
    // 12:00 UTC is 8:00pm in Malaysia.
    expect(within(section).getByText('Sat 7 Nov, 8:00pm')).toBeInTheDocument();
    expect(within(section).getByText('90 minutes · Online')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: copy.joinClass })).toHaveAttribute('href', 'https://meet.example/abc');
    expect(within(section).getByRole('link', { name: copy.addToCalendar })).toHaveAttribute('href', '/keklina/order/tok_abc/calendar?line=l4');
  });

  it('an in-person session says where, with no Join', () => {
    const line: Line = { ...sessionLine, digital: { ...sessionLine.digital!, place: 'IN_PERSON', where: 'Studio 3, Bangsar' } };
    render(<OrderView {...digital({}, [line])} />);
    expect(screen.getByText('90 minutes · In person, Studio 3, Bangsar')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: copy.joinClass })).toBeNull();
    expect(screen.getByRole('link', { name: copy.addToCalendar })).toBeInTheDocument();
  });

  it('a mixed order keeps the physical timeline and shows the downloads once paid', () => {
    render(
      <OrderView
        {...digital({ method: 'PICKUP', day: '2026-10-17', sentAt: '2026-10-15T01:00:01.000Z' }, [
          { itemName: 'Kek batik', optionLabel: null, unitPriceCents: 4500, quantity: 1 },
          filesLine(),
        ])}
      />,
    );
    expect(steps()).toEqual(['Placed, done', 'Paid, done', 'Ready ←', 'Done']);
    expect(screen.getByRole('region', { name: 'Your downloads' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: copy.yourOrder })).getByText('Pickup · Sat 17 Oct')).toBeInTheDocument();
  });

  it('a suspended shop still shows what was paid for, without buttons the API would refuse', () => {
    render(<OrderView {...digital({}, [filesLine(), codesLine, sessionLine, linkLine], { suspended: true })} />);
    expect(screen.queryByRole('link', { name: copy.joinClass })).toBeNull();
    expect(screen.queryByRole('link', { name: copy.openLink })).toBeNull();
    const section = screen.getByRole('region', { name: copy.dgTitle(false) });
    expect(within(section).getByText('KL50-AAAA')).toBeInTheDocument();
    expect(within(section).queryByRole('link', { name: copy.download })).toBeNull();
    expect(within(section).getByText(copy.pausedDownloads('Kek Lina'))).toBeInTheDocument();
  });

  it('speaks Malay on a Malay page', () => {
    render(<OrderView {...digital({}, [filesLine()], { language: 'ms' })} />);
    expect(screen.getByRole('region', { name: ms.dgTitle(true) })).toBeInTheDocument();
    expect(screen.getByText('4.2 MB · 5 muat turun lagi')).toBeInTheDocument();
    expect(screen.getByText(ms.statusSent)).toBeInTheDocument();
  });
});

describe('the placed screen after an online payment', () => {
  it('a digital-only order: paid, on its way to the email, with the button to the downloads', async () => {
    window.sessionStorage.setItem(payingKey('tok_abc'), '1');
    const scroll = vi.spyOn(window.HTMLElement.prototype, 'scrollIntoView');
    render(<OrderView {...digital()} />);
    expect(await screen.findByRole('heading', { name: 'Paid. It’s on its way to your email' })).toBeInTheDocument();
    expect(screen.getByText('RM25 paid. Your files are ready now.')).toBeInTheDocument();
    expect(screen.getByText('Sent to mira@example.com. It’s on your order page too.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Get your files' }));
    expect(screen.getByRole('region', { name: 'Your downloads' })).toBeInTheDocument();
    expect(scroll).toHaveBeenCalled();
  });

  it('a mixed order keeps "Paid. Order placed"', async () => {
    window.sessionStorage.setItem(payingKey('tok_abc'), '1');
    render(<OrderView {...digital({ method: 'PICKUP', day: '2026-10-17' }, [{ itemName: 'Kek batik', optionLabel: null, unitPriceCents: 4500, quantity: 1 }, filesLine()])} />);
    expect(await screen.findByRole('heading', { name: copy.paidPlaced })).toBeInTheDocument();
  });
});

describe('the order page route', () => {
  const line = (patch: Partial<PublicOrderLine>): PublicOrderLine => ({
    id: 'l1',
    itemName: 'Recipe e-book',
    optionLabel: null,
    unitPriceCents: 2500,
    quantity: 1,
    photoKey: null,
    kind: 'DIGITAL',
    delivery: 'FILES',
    accessNote: null,
    hasLink: false,
    sessionMinutes: null,
    sessionPlace: null,
    sessionWhere: null,
    sessionStartsAt: null,
    codes: [],
    grants: [],
    ...patch,
  });
  const order = (patch: Partial<PublicOrder>): PublicOrder =>
    ({
      id: 'o1',
      number: 21,
      code: '7Q4M',
      method: null,
      day: null,
      itemsCents: 2500,
      deliveryCents: 0,
      totalCents: 2500,
      status: 'PAID',
      receiptKey: null,
      receiptType: null,
      receiptUploadedAt: null,
      receiptRejectedAt: null,
      paidAt: new Date('2026-10-15T01:00:00.000Z'),
      refundedAt: null,
      paidVia: 'CHIP',
      paidMethodLabel: null,
      paidRef: null,
      chipPending: false,
      email: 'mira@example.com',
      sentAt: new Date('2026-10-15T01:00:01.000Z'),
      lines: [line({ grants: [{ id: 'g1', fileName: 'recipe.pdf', sizeBytes: 4_400_000, usesLeft: 5, expiresAt: new Date(FUTURE) }] })],
      page: { handle: 'keklina', displayName: 'Kek Lina', language: 'en', style: 'SOFT', accentColor: '#b5294e', headingFont: 'JAKARTA', avatarKey: null, coverKey: null, background: 'PAPER', backgroundColor: null, links: [], paymentQrKey: null, bankName: null, bankAccountName: null, bankAccountNumber: null, chipMethods: null, suspended: false },
      ...patch,
    }) as unknown as PublicOrder;

  it('puts nothing of a private link or meeting in the page before payment or for a suspended shop', async () => {
    const mixed = (patch: Partial<PublicOrder>, suspended = false) =>
      order({
        ...patch,
        page: { ...order({}).page, suspended },
        lines: [
          line({ id: 'l2', delivery: 'LINK', hasLink: true, accessNote: patch.status === 'PAID' ? 'the password is hunter2' : null }),
          line({ id: 'l4', delivery: 'SESSION', sessionPlace: 'ONLINE', sessionMinutes: 60, sessionStartsAt: new Date('2026-11-07T12:00:00Z'), sessionWhere: patch.status === 'PAID' ? 'https://meet.example/secret' : null }),
        ],
      });
    const html = async (o: PublicOrder) => {
      vi.mocked(getOrderByToken).mockResolvedValue(o);
      const { container } = render(await OrderPage({ params: Promise.resolve({ handle: 'keklina', token: 'tok_abc' }) }));
      return container.innerHTML;
    };
    const unpaid = await html(mixed({ status: 'PLACED', paidAt: null, sentAt: null }));
    expect(unpaid).not.toContain('hunter2');
    expect(unpaid).not.toContain('meet.example');
    cleanup();
    const suspended = await html(mixed({ status: 'PAID' }, true));
    expect(suspended).not.toContain('hunter2');
    expect(suspended).not.toContain('meet.example');
    expect(screen.queryByRole('link', { name: copy.joinClass })).toBeNull();
    expect(screen.getByRole('link', { name: copy.addToCalendar })).toBeInTheDocument();
    cleanup();
    expect(await html(mixed({ status: 'PAID' }))).toContain('hunter2');
  });

  it('renders a digital-only order instead of a 404', async () => {
    vi.mocked(getOrderByToken).mockResolvedValue(order({}));
    render(await OrderPage({ params: Promise.resolve({ handle: 'keklina', token: 'tok_abc' }) }));
    expect(screen.getByRole('region', { name: 'Your downloads' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: copy.download })).toHaveAttribute('href', 'http://localhost:3001/store/orders/tok_abc/files/g1');
  });
});
