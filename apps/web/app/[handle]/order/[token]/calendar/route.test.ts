import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicOrder, PublicOrderLine } from '@curios/db-read';

vi.mock('@curios/db-read', () => ({ getOrderByToken: vi.fn() }));

const { getOrderByToken } = await import('@curios/db-read');
const { GET } = await import('./route.js');
const { fold, icsText } = await import('./ics.js');

const session: Partial<PublicOrderLine> = {
  id: 'l4',
  itemName: 'Online class, with Lina; part 1',
  kind: 'DIGITAL',
  delivery: 'SESSION',
  sessionMinutes: 90,
  sessionPlace: 'ONLINE',
  sessionWhere: 'https://meet.example/abc',
  // 8:00pm in Malaysia.
  sessionStartsAt: new Date('2026-11-07T12:00:00.000Z'),
};
const order = (patch: Partial<PublicOrder> = {}, line: Partial<PublicOrderLine> = {}) =>
  ({
    number: 21,
    status: 'PAID',
    lines: [{ ...session, ...line }, { id: 'l1', delivery: 'FILES', kind: 'DIGITAL' }],
    page: { handle: 'keklina', displayName: 'Kek Lina' },
    ...patch,
  }) as unknown as PublicOrder;

const call = (query = '?line=l4', handle = 'keklina') =>
  GET(new Request(`http://localhost:3000/${handle}/order/tok/calendar${query}`), { params: Promise.resolve({ handle, token: 'tok' }) });

afterEach(() => vi.mocked(getOrderByToken).mockReset());

describe('GET /[handle]/order/[token]/calendar', () => {
  it('sends an .ics for a paid session, from the booked time and the sold minutes', async () => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce(order());
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="class-21.ics"');
    const text = await response.text();
    expect(text).toContain('BEGIN:VCALENDAR\r\n');
    expect(text).toContain('DTSTART:20261107T120000Z\r\n');
    expect(text).toContain('DTEND:20261107T133000Z\r\n');
    expect(text).toContain('UID:l4@curios\r\n');
    expect(text).toContain('LOCATION:https://meet.example/abc\r\n');
    expect(text).toContain('SUMMARY:Online class\\, with Lina\\; part 1\r\n');
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('uses the place for an in-person class', async () => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce(order({}, { sessionPlace: 'IN_PERSON', sessionWhere: 'Studio 3, Bangsar' }));
    expect(await (await call()).text()).toContain('LOCATION:Studio 3\\, Bangsar\r\n');
  });

  it('leaves the meeting link out of a suspended shop’s file, but keeps an in-person place', async () => {
    const suspended = { page: { handle: 'keklina', displayName: 'Kek Lina', suspended: true } } as unknown as Partial<PublicOrder>;
    vi.mocked(getOrderByToken).mockResolvedValueOnce(order(suspended));
    const online = await (await call()).text();
    expect(online).toContain('DTSTART:20261107T120000Z');
    expect(online).not.toContain('meet.example');
    expect(online).not.toContain('LOCATION');
    vi.mocked(getOrderByToken).mockResolvedValueOnce(order(suspended, { sessionPlace: 'IN_PERSON', sessionWhere: 'Studio 3, Bangsar' }));
    expect(await (await call()).text()).toContain('LOCATION:Studio 3\\, Bangsar');
  });

  it.each([
    ['unpaid', '?line=l4', 'keklina', order({ status: 'PLACED' })],
    ['cancelled', '?line=l4', 'keklina', order({ status: 'CANCELLED' })],
    ['no line', '', 'keklina', order()],
    ['a line that is not a session', '?line=l1', 'keklina', order()],
    ['a line of another order', '?line=elsewhere', 'keklina', order()],
    ['another shop', '?line=l4', 'other', order()],
    ['an unknown token', '?line=l4', 'keklina', null],
  ])('is a 404 for %s', async (_name, query, handle, found) => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce(found);
    expect((await call(query, handle)).status).toBe(404);
  });
});

const pickup = (patch: Partial<PublicOrder> = {}) =>
  order({
    id: 'o1',
    method: 'PICKUP',
    day: '2026-11-21',
    status: 'PAID',
    pickupFrom: 840,
    pickupTo: 1080,
    pickupPlaceName: 'Rumah Lina',
    pickupPlaceAddress: 'No. 12, Jalan Kenanga 7/3, Seksyen 7, Shah Alam',
    ...patch,
  });

describe('GET /[handle]/order/[token]/calendar?pickup=1', () => {
  it('sends an .ics for the pickup window, in Malaysia time, at the place', async () => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce(pickup());
    const response = await call('?pickup=1');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="pickup-21.ics"');
    const text = (await response.text()).replace(/\r\n /g, '');
    // 2pm and 6pm in Malaysia (UTC+8).
    expect(text).toContain('DTSTART:20261121T060000Z\r\n');
    expect(text).toContain('DTEND:20261121T100000Z\r\n');
    expect(text).toContain('UID:o1@curios\r\n');
    expect(text).toContain('SUMMARY:Pickup from Kek Lina\r\n');
    expect(text).toContain('LOCATION:Rumah Lina\\, No. 12\\, Jalan Kenanga 7/3\\, Seksyen 7\\, Shah Alam\r\n');
  });

  it('is an all-day event when the order kept no window', async () => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce(pickup({ pickupFrom: null, pickupTo: null }));
    const text = await (await call('?pickup=1')).text();
    expect(text).toContain('DTSTART;VALUE=DATE:20261121\r\n');
    expect(text).toContain('DTEND;VALUE=DATE:20261122\r\n');
  });

  it('is there before it is paid, because the day is the customer’s to add', async () => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce(pickup({ status: 'PLACED' }));
    expect((await call('?pickup=1')).status).toBe(200);
  });

  it.each([
    ['cancelled', pickup({ status: 'CANCELLED' })],
    ['a delivery order', pickup({ method: 'DELIVERY' })],
    ['an order with no day', pickup({ day: null })],
    ['an unknown token', null],
  ])('is a 404 for %s', async (_name, found) => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce(found);
    expect((await call('?pickup=1')).status).toBe(404);
  });
});

describe('ics text', () => {
  it('escapes commas, semicolons, backslashes and new lines', () => {
    expect(icsText('a, b; c\\d\ne')).toBe('a\\, b\\; c\\\\d\\ne');
  });

  it('folds long lines at 75 octets with a leading space on the rest', () => {
    const folded = fold(`DESCRIPTION:${'x'.repeat(200)}`);
    const parts = folded.split('\r\n');
    expect(parts[0]!.length).toBe(75);
    expect(parts.slice(1).every((p) => p.startsWith(' ') && p.length <= 75)).toBe(true);
    expect(parts.join('').replace(/ /g, '')).toBe(`DESCRIPTION:${'x'.repeat(200)}`);
  });
});
