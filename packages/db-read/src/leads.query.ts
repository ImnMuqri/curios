import { malaysiaToday } from '@curios/core/orders';
import type { Prisma } from '@prisma/client';
import { prismaRead } from './client.js';

export interface LeadTranscriptLine {
  role: 'USER' | 'ASSISTANT';
  content: string;
}

export interface LeadSlots {
  product: string | null;
  date: string | null;
  location: string | null;
  /** How many people, and their budget (an enquiry's For and Budget): picked out since 8 Nov 2026, so an older lead has neither. */
  people?: string | null;
  budget?: string | null;
}

export interface OwnerLead {
  id: string;
  phone: string;
  score: number;
  /** Null until the extraction job runs, and null forever if it failed. */
  slots: LeadSlots | null;
  status: 'NEW' | 'CONTACTED' | 'SOLD' | 'CLOSED';
  createdAt: Date;
  /** When the conversation began on the page: its first message, or the lead's own time when it has none. */
  startedAt: Date;
  /** The conversation's first TRANSCRIPT_LIMIT messages, in order. */
  transcript: LeadTranscriptLine[];
  /** Every message the conversation has, which is more than `transcript` holds when it was long. */
  messageCount: number;
  /**
   * How many of the transcript's messages came before the number was left,
   * so "Left their number" sits where it happened rather than at the end.
   * The capture card is not a message; the lead's own time places it.
   */
  capturedAfter: number;
  /**
   * An enquiry from an Ask item in the shop (HANDOFF "Shop: Ask items", 8 Nov 2026), or null for a number
   * left in the chat. `item` is null once the item was removed; its name is still in the first message.
   */
  enquiry: LeadEnquiry | null;
}

export interface LeadEnquiry {
  /** The name they gave. */
  name: string | null;
  /** Their message, in their own words. */
  note: string | null;
  item: { name: string; photoKey: string | null; fromCents: number | null } | null;
}

/** Messages sent with each lead: a conversation is usually a handful, and nothing caps how many it keeps. */
export const TRANSCRIPT_LIMIT = 60;

/**
 * Every lead this owner's pages have captured, newest first, `limit` at a time: `before` is the
 * last lead of the previous page, and the page after it starts below it.
 *
 * Newest first because a lead goes cold: the one captured an hour ago is the
 * one worth acting on, and burying it under a month of older ones is the
 * difference between a dashboard and an archive.
 *
 * The transcript comes back with each lead rather than on request. BACKEND.md
 * calls it "the feature people pay for", a conversation is a handful of short
 * rows, and a second round trip to fetch ten strings costs more than sending
 * them did. Its first TRANSCRIPT_LIMIT messages, so one long chat cannot
 * swell the whole screen; `messageCount` says when there were more.
 *
 * Scoped through the page's owner inside the query. This is a phone number --
 * showing the wrong owner's is the worst read bug this product could have.
 */
export async function getLeads(
  accountId: string,
  options: { limit?: number; before?: string } = {},
): Promise<OwnerLead[]> {
  // The cursor is read through the same scope, so another owner's lead id pages nothing.
  const cursor = options.before
    ? await prismaRead.lead.findFirst({ where: { id: options.before, page: { accountId } }, select: { id: true, createdAt: true } })
    : null;
  if (options.before && !cursor) return [];
  return readLeads(
    {
      page: { accountId },
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    },
    Math.min(options.limit ?? 50, 101),
  );
}

const newestFirst = (a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }) =>
  b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * The Leads screen a page at a time, newest first, as Orders pages (`getOwnerOrdersPage`): the first
 * page is every NEW lead, however old (the card, the chip and the sidebar badge count them all, so
 * none may fall off the list), and the newest `perPage` of the rest. `before` (the last of those
 * above) is the next `perPage` leads that are not NEW, on their own. `older` is the cursor for the
 * page after, or null at the end; null altogether when `before` is not one of this owner's leads
 * that are past NEW.
 */
export async function getLeadsPage(
  accountId: string,
  options: { before?: string; perPage?: number } = {},
): Promise<{ leads: OwnerLead[]; older: string | null } | null> {
  const scope = { page: { accountId } };
  const perPage = Math.min(Math.max(options.perPage ?? 50, 1), 100);
  const done: Prisma.LeadWhereInput[] = [scope, { status: { not: 'NEW' } }];
  if (options.before) {
    const cursor = await prismaRead.lead.findFirst({ where: { AND: [...done, { id: options.before }] }, select: { id: true, createdAt: true } });
    if (!cursor) return null;
    done.push({ OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] });
  }
  const [fresh, rest] = await Promise.all([
    options.before ? [] : readLeads({ ...scope, status: 'NEW' }),
    readLeads({ AND: done }, perPage + 1),
  ]);
  const shown = rest.slice(0, perPage);
  return { leads: [...fresh, ...shown].sort(newestFirst), older: rest.length > perPage ? (shown.at(-1)?.id ?? null) : null };
}

async function readLeads(where: Prisma.LeadWhereInput, take?: number): Promise<OwnerLead[]> {
  const rows = await prismaRead.lead.findMany({
    where,
    // id breaks a tie in createdAt, so a page boundary never skips or repeats a lead.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(take === undefined ? {} : { take }),
    select: {
      id: true,
      phone: true,
      score: true,
      slots: true,
      status: true,
      createdAt: true,
      kind: true,
      name: true,
      note: true,
      item: { select: { name: true, photoKey: true, priceCents: true } },
      conversation: {
        select: {
          messages: { select: { role: true, content: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: TRANSCRIPT_LIMIT },
          _count: { select: { messages: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    phone: row.phone,
    score: row.score,
    // Prisma types a Json column as JsonValue, which is not the shape this
    // codebase writes into it. The cast is at the boundary, once, rather than
    // every caller re-deciding what a slot is.
    slots: (row.slots as LeadSlots | null) ?? null,
    status: row.status,
    createdAt: row.createdAt,
    startedAt: row.conversation.messages[0]?.createdAt ?? row.createdAt,
    transcript: row.conversation.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    messageCount: row.conversation._count.messages,
    capturedAfter: row.conversation.messages.filter((message) => message.createdAt <= row.createdAt).length,
    enquiry:
      row.kind === 'ENQUIRY'
        ? { name: row.name, note: row.note, item: row.item ? { name: row.item.name, photoKey: row.item.photoKey, fromCents: row.item.priceCents } : null }
        : null,
  }));
}

export interface LeadStats {
  /** Leads still NEW: nobody has reached out yet. */
  waiting: number;
  /** Leads left over the last 7 Malaysian days, today included. */
  thisWeek: number;
  /** Leads the owner marked SOLD: closed into a sale. */
  sold: number;
  /** Leads left over the 7 Malaysian days before `thisWeek`'s. */
  lastWeek: number;
  /** Leads per Malaysian day, 7 slots, oldest first, today last (the week bar). */
  days: number[];
  /** Of the leads created in the last 7 Malaysian days, those the owner marked SOLD. */
  soldThisWeek: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Malaysia is UTC+8 all year. */
const MALAYSIA_OFFSET_MS = 8 * 3_600_000;

/** The Leads screen's figures, counted in the database rather than from the newest fifty. */
export async function getLeadStats(accountId: string, now = new Date()): Promise<LeadStats> {
  const scope = { page: { accountId } };
  const today = Date.parse(`${malaysiaToday(now)}T00:00:00Z`);
  const first = today - 6 * DAY_MS;
  const [waiting, sold, recent] = await Promise.all([
    prismaRead.lead.count({ where: { ...scope, status: 'NEW' } }),
    prismaRead.lead.count({ where: { ...scope, status: 'SOLD' } }),
    prismaRead.lead.findMany({
      where: { ...scope, createdAt: { gte: new Date(first - 7 * DAY_MS - MALAYSIA_OFFSET_MS), lt: new Date(today + DAY_MS - MALAYSIA_OFFSET_MS) } },
      select: { createdAt: true, status: true },
    }),
  ]);
  const days = [0, 0, 0, 0, 0, 0, 0];
  let lastWeek = 0;
  let soldThisWeek = 0;
  for (const lead of recent) {
    const slot = Math.floor((lead.createdAt.getTime() + MALAYSIA_OFFSET_MS - first) / DAY_MS);
    if (slot >= 0 && slot < 7) {
      days[slot] = (days[slot] ?? 0) + 1;
      if (lead.status === 'SOLD') soldThisWeek += 1;
    } else if (slot >= -7 && slot < 0) lastWeek += 1;
  }
  return { waiting, thisWeek: days.reduce((sum, n) => sum + n, 0), sold, lastWeek, days, soldThisWeek };
}
