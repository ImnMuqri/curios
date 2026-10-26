import { prismaRead } from './client.js';

export interface LeadTranscriptLine {
  role: 'USER' | 'ASSISTANT';
  content: string;
}

export interface LeadSlots {
  product: string | null;
  date: string | null;
  location: string | null;
}

export interface OwnerLead {
  id: string;
  phone: string;
  score: number;
  /** Null until the extraction job runs, and null forever if it failed. */
  slots: LeadSlots | null;
  status: 'NEW' | 'CONTACTED' | 'SOLD' | 'CLOSED';
  createdAt: Date;
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
  const rows = await prismaRead.lead.findMany({
    where: {
      page: { accountId },
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
    },
    // id breaks a tie in createdAt, so a page boundary never skips or repeats a lead.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(options.limit ?? 50, 101),
    select: {
      id: true,
      phone: true,
      score: true,
      slots: true,
      status: true,
      createdAt: true,
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
    transcript: row.conversation.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    messageCount: row.conversation._count.messages,
    capturedAfter: row.conversation.messages.filter((message) => message.createdAt <= row.createdAt).length,
  }));
}

export interface LeadStats {
  /** Leads still NEW: nobody has reached out yet. */
  waiting: number;
  /** Leads left in the last seven days. */
  thisWeek: number;
  /** Leads the owner marked SOLD: closed into a sale. */
  sold: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Leads screen's three figures, counted in the database rather than from the newest fifty. */
export async function getLeadStats(accountId: string, now = new Date()): Promise<LeadStats> {
  const scope = { page: { accountId } };
  const [waiting, sold, thisWeek] = await Promise.all([
    prismaRead.lead.count({ where: { ...scope, status: 'NEW' } }),
    prismaRead.lead.count({ where: { ...scope, status: 'SOLD' } }),
    prismaRead.lead.count({ where: { ...scope, createdAt: { gt: new Date(now.getTime() - 7 * DAY_MS), lte: now } } }),
  ]);
  return { waiting, thisWeek, sold };
}
