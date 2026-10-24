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
