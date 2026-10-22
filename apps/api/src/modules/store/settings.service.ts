import type { Prisma, PrismaClient } from '@curios/db';
import {
  BANK_ACCOUNT_NAME_MAX,
  BANK_NAME_MAX,
  DELIVERY_FEE_MAX_CENTS,
  DELIVERY_NOTE_MAX,
  MIN_NOTICE_DAYS_MAX,
  normalizeBankAccountNumber,
  PICKUP_NOTE_MAX,
  SHOP_DESCRIPTION_MAX,
  storeGapMessage,
  storeGaps,
  type DeliveryMode,
} from '@curios/core/store';
import type { TileSize } from '@curios/core/bento';
import { InvalidStoreSettingError, StoreNotReadyError } from './store.errors.js';
import { storePageFor } from './store-page.js';

export interface StoreSettings {
  enabled: boolean;
  /** The owner says the shop sells halal food; shown on the shop and product pages. */
  shopHalal: boolean;
  /** "About your shop", shown above the items. */
  shopDescription: string | null;
  pickupEnabled: boolean;
  pickupNote: string | null;
  deliveryMode: DeliveryMode;
  deliveryFeeCents: number | null;
  minNoticeDays: number;
  /** Weekdays no order can be for, 0 = Sunday to 6 = Saturday. */
  closedDays: number[];
  deliveryNote: string | null;
  paymentQrKey: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  tileSize: TileSize | null;
}

export type StoreSettingsPatch = Partial<Omit<StoreSettings, 'paymentQrKey'>>;

const SELECT = {
  storeEnabled: true,
  shopHalal: true,
  shopDescription: true,
  pickupEnabled: true,
  pickupNote: true,
  deliveryMode: true,
  deliveryFeeCents: true,
  minNoticeDays: true,
  closedDays: true,
  deliveryNote: true,
  paymentQrKey: true,
  bankName: true,
  bankAccountName: true,
  bankAccountNumber: true,
  shopTileSize: true,
} as const;

// `@curios/db` re-exports `@prisma/client`, so `Prisma` types come from there.
type Row = Prisma.PageGetPayload<{ select: typeof SELECT }>;

function toSettings(row: Row): StoreSettings {
  const { storeEnabled, shopTileSize, ...rest } = row;
  return { enabled: storeEnabled, tileSize: shopTileSize, ...rest };
}

/** Trimmed, null when blank, refused when longer than `max` characters. */
function optionalText(raw: string | null, max: number, what: string): string | null {
  if (raw === null) return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  if ([...text].length > max) throw new InvalidStoreSettingError(`Keep ${what} to ${max} characters.`);
  return text;
}

/** Whether the page has a CHIP account connected: a way to pay as good as a QR or bank details. */
export async function chipConnected(prisma: PrismaClient, pageId: string): Promise<boolean> {
  return (await prisma.shopPaymentAccount.count({ where: { pageId } })) > 0;
}

export async function getStoreSettings(prisma: PrismaClient, accountId: string): Promise<StoreSettings> {
  const page = await storePageFor(prisma, accountId);
  return toSettings(await prisma.page.findUniqueOrThrow({ where: { id: page.id }, select: SELECT }));
}

/**
 * Applies a patch, checked against the shop as it will be afterwards -- so one
 * request can add bank details and open the shop, and no request can leave an
 * open shop without a way to pay or hand over.
 */
export async function updateStoreSettings(prisma: PrismaClient, accountId: string, patch: StoreSettingsPatch): Promise<StoreSettings> {
  const page = await storePageFor(prisma, accountId);
  const current = toSettings(await prisma.page.findUniqueOrThrow({ where: { id: page.id }, select: SELECT }));
  const next: StoreSettings = { ...current };

  if (patch.shopHalal !== undefined) next.shopHalal = patch.shopHalal;
  if (patch.pickupEnabled !== undefined) next.pickupEnabled = patch.pickupEnabled;
  if (patch.shopDescription !== undefined) next.shopDescription = optionalText(patch.shopDescription, SHOP_DESCRIPTION_MAX, 'the shop description');
  if (patch.pickupNote !== undefined) next.pickupNote = optionalText(patch.pickupNote, PICKUP_NOTE_MAX, 'the pickup note');
  if (patch.bankName !== undefined) next.bankName = optionalText(patch.bankName, BANK_NAME_MAX, 'the bank name');
  if (patch.bankAccountName !== undefined) next.bankAccountName = optionalText(patch.bankAccountName, BANK_ACCOUNT_NAME_MAX, 'the account name');
  if (patch.bankAccountNumber !== undefined) {
    if (patch.bankAccountNumber === null || patch.bankAccountNumber.trim() === '') next.bankAccountNumber = null;
    else {
      const digits = normalizeBankAccountNumber(patch.bankAccountNumber);
      if (!digits) throw new InvalidStoreSettingError('That account number does not look right. Use the digits on your bank card or app.');
      next.bankAccountNumber = digits;
    }
  }
  if (patch.minNoticeDays !== undefined) {
    if (!Number.isInteger(patch.minNoticeDays) || patch.minNoticeDays < 0 || patch.minNoticeDays > MIN_NOTICE_DAYS_MAX) {
      throw new InvalidStoreSettingError(`Notice is a whole number of days, from 0 to ${MIN_NOTICE_DAYS_MAX}.`);
    }
    next.minNoticeDays = patch.minNoticeDays;
  }
  if (patch.closedDays !== undefined) {
    const days = patch.closedDays;
    if (!days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) || new Set(days).size !== days.length) {
      throw new InvalidStoreSettingError('Closed days are weekdays, each named once.');
    }
    if (days.length >= 7) throw new StoreNotReadyError('Leave at least one day open.');
    next.closedDays = [...days].sort((a, b) => a - b);
  }
  if (patch.deliveryNote !== undefined) next.deliveryNote = optionalText(patch.deliveryNote, DELIVERY_NOTE_MAX, 'the delivery note');
  if (patch.deliveryMode !== undefined) next.deliveryMode = patch.deliveryMode;
  if (patch.deliveryFeeCents !== undefined) next.deliveryFeeCents = patch.deliveryFeeCents;
  if (next.deliveryMode === 'FLAT') {
    const fee = next.deliveryFeeCents;
    if (fee === null || !Number.isInteger(fee) || fee <= 0 || fee > DELIVERY_FEE_MAX_CENTS) {
      throw new InvalidStoreSettingError('Give flat delivery a fee above RM0, up to RM500.');
    }
  } else {
    // A fee only means something for FLAT; keeping one under RIDER would let
    // slice 18 add it to a total the customer was told excludes it.
    next.deliveryFeeCents = null;
  }
  if (patch.tileSize !== undefined) next.tileSize = patch.tileSize;
  if (patch.enabled !== undefined) next.enabled = patch.enabled;

  if (next.enabled) {
    const gaps = storeGaps({ ...next, chipConnected: await chipConnected(prisma, page.id) });
    if (gaps.length > 0) throw new StoreNotReadyError(storeGapMessage(gaps));
  }

  const { enabled, tileSize, paymentQrKey: _qr, ...columns } = next;
  const row = await prisma.page.update({
    where: { id: page.id },
    data: { ...columns, storeEnabled: enabled, shopTileSize: tileSize },
    select: SELECT,
  });
  return toSettings(row);
}

/** Records a new QR key and returns the one it replaced, for the caller to remove from storage. */
export async function setPaymentQr(prisma: PrismaClient, pageId: string, key: string): Promise<string | null> {
  const before = await prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { paymentQrKey: true } });
  await prisma.page.update({ where: { id: pageId }, data: { paymentQrKey: key } });
  return before.paymentQrKey;
}

/** Clears the QR unless it is an open shop's only way to pay. Returns the removed key. */
export async function clearPaymentQr(prisma: PrismaClient, pageId: string): Promise<string | null> {
  const row = await prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: SELECT });
  const settings = toSettings(row);
  if (settings.enabled) {
    const gaps = storeGaps({ ...settings, paymentQrKey: null, chipConnected: await chipConnected(prisma, pageId) });
    if (gaps.length > 0) {
      throw new StoreNotReadyError('Your shop is open and this QR is its only way to pay. Add bank details, connect CHIP, or close the shop first.');
    }
  }
  await prisma.page.update({ where: { id: pageId }, data: { paymentQrKey: null } });
  return settings.paymentQrKey;
}
