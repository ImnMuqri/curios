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
  status: 'NEW' | 'CONTACTED' | 'CLOSED';
  createdAt: Date;
  transcript: LeadTranscriptLine[];
}

/**
 * Every lead this owner's pages have captured, newest first.
 *
 * Newest first because a lead goes cold: the one captured an hour ago is the
 * one worth acting on, and burying it under a month of older ones is the
 * difference between a dashboard and an archive.
 *
 * The transcript comes back with each lead rather than on request. BACKEND.md
 * calls it "the feature people pay for", a conversation is a handful of short
 * rows, and a second round trip to fetch ten strings costs more than sending
 * them did.
 *
 * Scoped through the page's owner inside the query. This is a phone number --
 * showing the wrong owner's is the worst read bug this product could have.
 */
export async function getLeads(
  accountId: string,
  options: { limit?: number } = {},
): Promise<OwnerLead[]> {
  const rows = await prismaRead.lead.findMany({
    where: { page: { accountId } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(options.limit ?? 50, 100),
    select: {
      id: true,
      phone: true,
      score: true,
      slots: true,
      status: true,
      createdAt: true,
      conversation: {
        select: {
          messages: { select: { role: true, content: true }, orderBy: { createdAt: 'asc' } },
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
  }));
}

export interface LeadStats {
  /** Leads still NEW: nobody has reached out yet. */
  waiting: number;
  /** Leads left in each of the last seven days, oldest first, today (the last 24 hours) last. */
  week: number[];
  /** Leads the owner marked CLOSED. */
  closed: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Leads screen's three figures, counted in the database rather than from the newest fifty. */
export async function getLeadStats(accountId: string, now = new Date()): Promise<LeadStats> {
  const scope = { page: { accountId } };
  const [waiting, closed, recent] = await Promise.all([
    prismaRead.lead.count({ where: { ...scope, status: 'NEW' } }),
    prismaRead.lead.count({ where: { ...scope, status: 'CLOSED' } }),
    prismaRead.lead.findMany({
      where: { ...scope, createdAt: { gt: new Date(now.getTime() - 7 * DAY_MS), lte: now } },
      select: { createdAt: true },
    }),
  ]);
  const week = [0, 0, 0, 0, 0, 0, 0];
  for (const lead of recent) week[6 - Math.floor((now.getTime() - lead.createdAt.getTime()) / DAY_MS)]! += 1;
  return { waiting, week, closed };
}
