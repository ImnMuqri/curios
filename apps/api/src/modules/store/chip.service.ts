import type { PrismaClient } from '@curios/db';
import { ChipRefusedError, ChipUnavailableError, type ChipClient } from '@curios/billing';
import { openSecret, sealSecret } from '@curios/core/secret-box';
import { storeGaps } from '@curios/core/store';
import { errName } from '../billing/billing.service.js';
import { getStoreSettings } from './settings.service.js';
import {
  ChipKeyRefusedError,
  ChipNoCheckMethodError,
  ChipNoTestMethodError,
  ChipNotConnectedError,
  ChipPaymentInFlightError,
  ChipReconnectError,
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


/** A purchase CHIP would not start: the key (401, 403), CHIP's own trouble (429), or the account. */
function purchaseRefused(status: number): Error {
  if ([401, 403].includes(status)) return new ChipKeyRefusedError();
  if (status === 429) return new ChipUnavailableError(`answered ${status}`);
  return new ChipTestRefusedError();
}

/** The methods an RM1 purchase here may be paid with: cards and e-wallets on this account. */
const cardOrWallet = (methods: string[]) => methods.filter((method) => TEST_METHODS.has(method));

/**
 * Checks the owner's Brand ID and secret key with CHIP, then stores the key sealed with
 * the brand, CHIP's public key (which verifies this shop's callbacks) and the methods the
 * account can take. Connecting again replaces all of it.
 *
 * Neither the payment methods nor the public key say whether a key is a test one; only a
 * purchase does. So connecting starts an RM1 purchase on the owner's brand (card and
 * e-wallet only, no callback; an account with neither is refused), reads its `is_test` and brand name, and cancels it at once:
 * nothing is paid and no money moves. In production a test key is refused here, before
 * anything is stored -- a shop must never open on a key that takes no real money.
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

  const owner = await deps.prisma.page.findUniqueOrThrow({
    where: { id: page.id },
    select: { displayName: true, account: { select: { email: true } } },
  });
  // Card and e-wallet, as the RM1 test; FPX alone for an account with neither (nobody
  // pays this purchase: it is cancelled at once). Never CHIP's QR.
  const cardsAndWallets = cardOrWallet(methods);
  const allowed = cardsAndWallets.length > 0 ? cardsAndWallets : methods.includes('fpx') ? ['fpx'] : [];
  if (allowed.length === 0) throw new ChipNoCheckMethodError();
  // Swapping in another CHIP account would strand a purchase a customer may be paying.
  const current = await deps.prisma.shopPaymentAccount.findUnique({ where: { pageId: page.id }, select: { brandId: true } });
  if (current && current.brandId !== brandId && (await paymentInFlight(deps.prisma, page.id, input.now))) throw new ChipPaymentInFlightError();
  const check = await withOwnerKey(
    () =>
      client.createPurchase({
        email: owner.account.email,
        fullName: owner.displayName,
        productName: 'Curios key check',
        amountCents: TEST_AMOUNT_CENTS,
        reference: 'Curios key check',
        redirectUrl: `${deps.appUrl}/app/store`,
        dueAt: new Date(input.now.getTime() + 60 * 60 * 1000),
        sendReceipt: false,
        cardsOnlyRecurring: false,
        methods: allowed,
      }),
    purchaseRefused,
  );
  await client.cancelPurchase(check.id).catch((error: unknown) =>
    deps.log.warn({ pageId: page.id, purchaseId: check.id, err: errName(error) }, 'key check purchase could not be cancelled'),
  );
  if (deps.production && check.isTest) throw new ChipTestKeyError();

  const data = {
    brandId,
    brandName: check.brandName ?? null,
    secretKeyCiphertext: sealSecret(secretKey, deps.secretsKey),
    publicKeyPem,
    methods,
    isTest: check.isTest,
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
 * Whether a customer may be paying through the shop's CHIP account right now: a placed
 * order whose purchase is still payable (its due_strict time, an hour from creation).
 */
async function paymentInFlight(prisma: PrismaClient, pageId: string, now: Date): Promise<boolean> {
  const paying = await prisma.order.findFirst({
    where: { pageId, status: 'PLACED', chipPurchaseId: { not: null }, chipPurchaseDueAt: { gt: now } },
    select: { id: true },
  });
  return paying !== null;
}

/** Whether the shop can lose CHIP: closed, or open with a QR or bank details to pay by. */
async function canSpareChip(prisma: PrismaClient, accountId: string): Promise<boolean> {
  const settings = await getStoreSettings(prisma, accountId);
  return !(settings.enabled && storeGaps({ ...settings, chipConnected: false }).includes('payment'));
}

/**
 * Forgets the owner's CHIP account. Idempotent. Refused while the shop is open and CHIP
 * is its only way to pay, as removing the QR is: no request leaves an open shop with
 * nothing to pay by.
 */
export async function disconnectChip(prisma: PrismaClient, accountId: string, now: Date): Promise<void> {
  const page = await storePageFor(prisma, accountId);
  // Its key is what confirms a payment in flight; it goes once nobody can still pay.
  if (await paymentInFlight(prisma, page.id, now)) throw new ChipPaymentInFlightError();
  if (!(await canSpareChip(prisma, accountId))) {
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
 * Connecting already refuses a test key in production, so finding one here means CHIP
 * changed its mind about the key. The purchase is cancelled and the request refused; the
 * connection is removed when the shop can spare it, and otherwise kept with lastErrorAt
 * set, so an open shop is never left with nothing to pay by.
 */
export async function testChip(deps: ShopChipDeps, input: { accountId: string; now: Date }): Promise<{ url: string }> {
  const page = await storePageFor(deps.prisma, input.accountId);
  const row = await deps.prisma.shopPaymentAccount.findUnique({
    where: { pageId: page.id },
    select: { brandId: true, secretKeyCiphertext: true, brandName: true, page: { select: { displayName: true, account: { select: { email: true } } } } },
  });
  if (!row) throw new ChipNotConnectedError();

  let secretKey: string;
  try {
    secretKey = openSecret(row.secretKeyCiphertext, deps.secretsKey);
  } catch (error) {
    // Sealed under a PAYMENT_SECRETS_KEY that has since changed: marked as a refused key
    // is (the Store and the alert say so, checkout stops offering it), and only
    // connecting again mends it.
    deps.log.warn({ pageId: page.id, err: errName(error) }, 'shop chip key could not be opened');
    await deps.prisma.shopPaymentAccount.updateMany({ where: { pageId: page.id }, data: { lastErrorAt: input.now } });
    throw new ChipReconnectError();
  }
  const client = deps.clientFor({ secretKey, brandId: row.brandId });
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

  const methods = cardOrWallet(await noteRefusal(() => client.listPaymentMethods(TEST_AMOUNT_CENTS)));
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
    purchaseRefused,
  );

  if (deps.production && purchase.isTest) {
    await client.cancelPurchase(purchase.id).catch((error: unknown) =>
      deps.log.warn({ pageId: page.id, purchaseId: purchase.id, err: errName(error) }, 'test purchase could not be cancelled'),
    );
    if (await canSpareChip(deps.prisma, input.accountId)) {
      await deps.prisma.shopPaymentAccount.deleteMany({ where: { pageId: page.id } });
    } else {
      await deps.prisma.shopPaymentAccount.updateMany({ where: { pageId: page.id }, data: { isTest: true, lastErrorAt: input.now } });
    }
    throw new ChipTestKeyError();
  }

  await deps.prisma.shopPaymentAccount.updateMany({
    where: { pageId: page.id },
    data: { checkedAt: input.now, lastErrorAt: null, isTest: purchase.isTest, brandName: purchase.brandName ?? row.brandName },
  });
  return { url: purchase.checkoutUrl };
}
