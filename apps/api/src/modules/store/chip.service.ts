import type { PrismaClient } from '@curios/db';
import { ChipRefusedError, ChipUnavailableError, type ChipClient } from '@curios/billing';
import { openSecret, sealSecret } from '@curios/core/secret-box';
import { storeGaps } from '@curios/core/store';
import { errName } from '../billing/billing.service.js';
import { getStoreSettings } from './settings.service.js';
import {
  ChipKeyRefusedError,
  ChipNoTestMethodError,
  ChipNotConnectedError,
  ChipTestKeyError,
  ChipTestRefusedError,
  InvalidChipKeyError,
  StoreNotReadyError,
} from './store.errors.js';
import { storePageFor } from './store-page.js';

/** Builds a CHIP client for one owner's own key and brand. */
export type ChipClientFor = (credentials: { secretKey: string; brandId: string }) => ChipClient;

export interface ShopChipDeps {
  prisma: PrismaClient;
  clientFor: ChipClientFor;
  /** PAYMENT_SECRETS_KEY: seals the owner's key before it is stored. */
  secretsKey: Buffer;
  /** In production a test key is refused: it would take orders that move no money. */
  production: boolean;
  appUrl: string;
  log: { warn: (obj: object, msg: string) => void };
}

/** What the owner's screen may know about the connection. Never the key. */
export interface ChipConnection {
  connected: true;
  brandName: string | null;
  methods: string[];
  checkedAt: Date;
  isTest: boolean;
}

/** The amount connecting checks the methods at: RM10 clears every method's minimum (CHIP's own advice). */
const CHECK_AMOUNT_CENTS = 1000;
/** "Test with RM1". */
const TEST_AMOUNT_CENTS = 100;

/**
 * What the RM1 test may be paid with: cards and e-wallets, never FPX (the owner's
 * answer 4) and never CHIP's DuitNow QR (the owner's own QR is the only QR option).
 */
const TEST_METHODS = new Set(['visa', 'mastercard', 'maestro', 'razer_tng', 'razer_grabpay', 'shopee_pay', 'razer_shopeepay']);

/** A CHIP Brand ID is a UUID. */
const BRAND_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A secret key is one unbroken token; CHIP's are long. */
const SECRET_KEY = /^\S{20,512}$/;

/**
 * Calls CHIP with the owner's key and turns every failure into something safe to send
 * and to log. A key or brand CHIP refuses becomes "that didn't work"; an outage stays
 * ChipUnavailableError; anything else becomes a plain error carrying only the original
 * error's name -- a refused call's message holds CHIP's response body, which is never
 * logged.
 */
async function withOwnerKey<T>(call: () => Promise<T>, refused: (status: number) => Error = keyRefused): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ChipUnavailableError) throw error;
    if (error instanceof ChipRefusedError) throw refused(error.status);
    throw new Error(`A call to CHIP failed: ${errName(error)}`);
  }
}

/** 400, 401, 403 and 404 mean the key or brand is wrong; a 429 or anything odder is CHIP's trouble. */
function keyRefused(status: number): Error {
  return [400, 401, 403, 404].includes(status) ? new ChipKeyRefusedError() : new ChipUnavailableError(`answered ${status}`);
}

/**
 * Checks the owner's Brand ID and secret key with CHIP, then stores the key sealed with
 * the brand, CHIP's public key (which verifies this shop's callbacks) and the methods the
 * account can take. Connecting again replaces all of it.
 *
 * Test mode is not visible from either call made here (neither the payment methods nor
 * the public key say), so `isTest` starts false and is learned from the first purchase
 * on the key -- "Test with RM1", or an order.
 */
export async function connectChip(
  deps: ShopChipDeps,
  input: { accountId: string; brandId: string; secretKey: string; now: Date },
): Promise<ChipConnection> {
  const page = await storePageFor(deps.prisma, input.accountId);
  const brandId = input.brandId.trim();
  const secretKey = input.secretKey.trim();
  if (!BRAND_ID.test(brandId)) throw new InvalidChipKeyError("That Brand ID doesn't look right. Copy it from your CHIP dashboard, under Developers.");
  if (!SECRET_KEY.test(secretKey)) throw new InvalidChipKeyError("That secret key doesn't look right. Copy it from your CHIP dashboard, under Developers.");

  const client = deps.clientFor({ secretKey, brandId });
  const methods = await withOwnerKey(() => client.listPaymentMethods(CHECK_AMOUNT_CENTS));
  const publicKeyPem = await withOwnerKey(() => client.getPublicKey());

  const data = {
    brandId,
    brandName: null,
    secretKeyCiphertext: sealSecret(secretKey, deps.secretsKey),
    publicKeyPem,
    methods,
    isTest: false,
    connectedAt: input.now,
    checkedAt: input.now,
    lastErrorAt: null,
  };
  const row = await deps.prisma.shopPaymentAccount.upsert({
    where: { pageId: page.id },
    create: { pageId: page.id, provider: 'CHIP', ...data },
    update: data,
    select: { brandName: true, methods: true, checkedAt: true, isTest: true },
  });
  return { connected: true, ...row };
}

/**
 * Forgets the owner's CHIP account. Idempotent. Refused while the shop is open and CHIP
 * is its only way to pay, as removing the QR is: no request leaves an open shop with
 * nothing to pay by.
 */
export async function disconnectChip(prisma: PrismaClient, accountId: string): Promise<void> {
  const page = await storePageFor(prisma, accountId);
  const settings = await getStoreSettings(prisma, accountId);
  if (settings.enabled && storeGaps({ ...settings, chipConnected: false }).includes('payment')) {
    throw new StoreNotReadyError('Your shop is open and CHIP is its only way to pay. Add a DuitNow QR or bank details, or close the shop first.');
  }
  await prisma.shopPaymentAccount.deleteMany({ where: { pageId: page.id } });
}

/**
 * "Test with RM1": a real RM1 purchase on the owner's own brand with their own key, to be
 * paid by card or e-wallet only, returning to Store. It marks nothing in Curios. The
 * methods are asked for again at RM1, which re-checks the key; the purchase says whether
 * the key is a test one and what the brand is called, and both are kept.
 *
 * A test key in production is refused here, where it first shows: the purchase is
 * cancelled and the connection removed.
 */
export async function testChip(deps: ShopChipDeps, input: { accountId: string; now: Date }): Promise<{ url: string }> {
  const page = await storePageFor(deps.prisma, input.accountId);
  const row = await deps.prisma.shopPaymentAccount.findUnique({
    where: { pageId: page.id },
    select: { brandId: true, secretKeyCiphertext: true, brandName: true, page: { select: { displayName: true, account: { select: { email: true } } } } },
  });
  if (!row) throw new ChipNotConnectedError();

  const client = deps.clientFor({ secretKey: openSecret(row.secretKeyCiphertext, deps.secretsKey), brandId: row.brandId });
  const noteRefusal = async <T>(call: () => Promise<T>, refused?: (status: number) => Error): Promise<T> => {
    try {
      return await withOwnerKey(call, refused);
    } catch (error) {
      if (error instanceof ChipKeyRefusedError) {
        await deps.prisma.shopPaymentAccount.updateMany({ where: { pageId: page.id }, data: { lastErrorAt: input.now } });
      }
      throw error;
    }
  };

  const methods = (await noteRefusal(() => client.listPaymentMethods(TEST_AMOUNT_CENTS))).filter((method) => TEST_METHODS.has(method));
  if (methods.length === 0) throw new ChipNoTestMethodError();

  const purchase = await noteRefusal(
    () =>
      client.createPurchase({
        email: row.page.account.email,
        fullName: row.page.displayName,
        productName: 'Curios test',
        amountCents: TEST_AMOUNT_CENTS,
        reference: 'Curios test',
        redirectUrl: `${deps.appUrl}/app/store`,
        dueAt: new Date(input.now.getTime() + 60 * 60 * 1000),
        sendReceipt: false,
        cardsOnlyRecurring: false,
        methods,
      }),
    (status) => ([401, 403].includes(status) ? new ChipKeyRefusedError() : status === 429 ? new ChipUnavailableError(`answered ${status}`) : new ChipTestRefusedError()),
  );

  if (deps.production && purchase.isTest) {
    await client.cancelPurchase(purchase.id).catch((error: unknown) =>
      deps.log.warn({ pageId: page.id, purchaseId: purchase.id, err: errName(error) }, 'test purchase could not be cancelled'),
    );
    await deps.prisma.shopPaymentAccount.deleteMany({ where: { pageId: page.id } });
    throw new ChipTestKeyError();
  }

  await deps.prisma.shopPaymentAccount.updateMany({
    where: { pageId: page.id },
    data: { checkedAt: input.now, lastErrorAt: null, isTest: purchase.isTest, brandName: purchase.brandName ?? row.brandName },
  });
  return { url: purchase.checkoutUrl };
}
