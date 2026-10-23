import { prismaRead } from './client.js';

export interface OwnerPage {
  id: string;
  handle: string;
  displayName: string;
  published: boolean;
  /** When the Curios team suspended the page, or null; the dashboard says so on every screen. */
  suspendedAt: Date | null;
  /** What the team wrote as the reason, shown to the owner. */
  suspendReason: string | null;
  mode: 'PERSONAL' | 'BUSINESS';
  /** Paid through this instant, or null for never paid. */
  paidUntil: Date | null;
  /** Leads ever captured. Never decremented -- deleting a lead does not return one. */
  leadsCaptured: number;
  /** Orders ever placed on this page. Never decremented: order numbers come from it. */
  ordersPlaced: number;
  /** `ordersPlaced` as it stood at the trial reset; the free orders count from here. */
  ordersAtTrialReset: number;
  /** When the owner spent their one trial reset, or null while it is unspent. */
  trialResetAt: Date | null;
  /** Whether the owner has switched the shop on: a shop that is off is not paused, only closed. */
  storeEnabled: boolean;
  /** Whether this page, if personal, may appear in search results. Settings' switch. */
  allowSearchIndexing: boolean;
  /** The owner's picture, for the sidebar's account row. */
  avatarKey: string | null;
  /** The shop's CHIP key was refused or could not be opened: customers cannot pay online until it is reconnected. */
  chipRefused: boolean;
  /** The shop has its own QR or full bank details to pay by (storeGaps's rule), so it never rests on CHIP alone. */
  payByQr: boolean;
}

/**
 * The signed-in owner's own page, published or not.
 *
 * Deliberately not a reuse of `getPublicPage`. That one takes a handle and
 * filters `published: true`, which is right for a visitor and useless here: an
 * owner who has not published yet would look to the dashboard exactly like an
 * owner who has no page, which is the one distinction onboarding turns on.
 *
 * `findUnique`, not `findFirst`. `Page.accountId` carries a unique index, so
 * at most one row can ever match, and saying so in the call is the difference
 * between a query that happens to return one row and one that cannot return
 * two. Prisma exposes `accountId` directly on the unique-where input for a
 * single-field `@@unique`, so there is no composite key name to work around.
 *
 * Carries the plan columns because the leads screen has to explain itself: an
 * owner whose trial is spent sees the capture card vanish from their page, and
 * without a count on the one screen they check for leads, the only signal is
 * that leads stopped arriving.
 */
export async function getOwnerPage(accountId: string): Promise<OwnerPage | null> {
  const page = await prismaRead.page.findUnique({
    where: { accountId },
    select: {
      id: true,
      handle: true,
      displayName: true,
      published: true,
      suspendedAt: true,
      suspendReason: true,
      mode: true,
      paidUntil: true,
      leadsCaptured: true,
      ordersPlaced: true,
      ordersAtTrialReset: true,
      trialResetAt: true,
      storeEnabled: true,
      allowSearchIndexing: true,
      avatarKey: true,
      paymentQrKey: true,
      bankName: true,
      bankAccountName: true,
      bankAccountNumber: true,
      // Whether, never the key: the sealed key is not selected by any page query.
      paymentAccount: { select: { lastErrorAt: true } },
    },
  });
  if (!page) return null;
  const { paymentAccount, paymentQrKey, bankName, bankAccountName, bankAccountNumber, ...rest } = page;
  return {
    ...rest,
    chipRefused: paymentAccount?.lastErrorAt != null,
    payByQr: Boolean(paymentQrKey || (bankName && bankAccountName && bankAccountNumber)),
  };
}
