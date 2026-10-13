import type { PrismaClient } from '@curios/db';
import { ITEM_DESCRIPTION_MAX, ITEM_NAME_MAX, MAX_ITEMS, pricingProblem, type Pricing } from '@curios/core/store';
import { InvalidItemError, ItemLimitError, ItemNotFoundError, ItemOrderStaleError } from './store.errors.js';
import { storePageFor } from './store-page.js';

export interface ItemRow {
  id: string;
  name: string;
  description: string | null;
  photoKey: string | null;
  available: boolean;
  priceCents: number | null;
  options: { id: string; label: string; priceCents: number }[];
}

const SELECT = {
  id: true,
  name: true,
  description: true,
  photoKey: true,
  available: true,
  priceCents: true,
  options: { orderBy: { position: 'asc' }, select: { id: true, label: true, priceCents: true } },
} as const;

function checkName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name === '' || [...name].length > ITEM_NAME_MAX) throw new InvalidItemError(`Give the item a name, up to ${ITEM_NAME_MAX} characters.`);
  return name;
}

function checkDescription(raw: string | null): string | null {
  if (raw === null) return null;
  const text = raw.trim();
  if (text === '') return null;
  if ([...text].length > ITEM_DESCRIPTION_MAX) throw new InvalidItemError(`Keep the description to ${ITEM_DESCRIPTION_MAX} characters.`);
  return text;
}

function checkPricing(pricing: Pricing): Pricing {
  const problem = pricingProblem(pricing);
  if (problem) throw new InvalidItemError(problem);
  return pricing.kind === 'options'
    ? { kind: 'options', options: pricing.options.map((o) => ({ label: o.label.trim(), priceCents: o.priceCents })) }
    : pricing;
}

/** The columns and nested options a pricing writes. Options are replaced whole, never patched. */
function pricingData(pricing: Pricing) {
  return pricing.kind === 'single'
    ? { priceCents: pricing.priceCents, options: [] as { label: string; priceCents: number; position: number }[] }
    : { priceCents: null, options: pricing.options.map((o, position) => ({ ...o, position })) };
}

export async function listItems(prisma: PrismaClient, accountId: string): Promise<ItemRow[]> {
  const page = await storePageFor(prisma, accountId);
  return prisma.item.findMany({ where: { pageId: page.id }, orderBy: { position: 'asc' }, select: SELECT });
}

/** Appended last. Count-then-create can overshoot MAX_ITEMS by one under a race; a product limit, not a safety one -- as addLink argues. */
export async function addItem(
  prisma: PrismaClient,
  accountId: string,
  input: { name: string; description?: string | null; pricing: Pricing },
): Promise<ItemRow> {
  const name = checkName(input.name);
  const description = checkDescription(input.description ?? null);
  const { priceCents, options } = pricingData(checkPricing(input.pricing));
  const page = await storePageFor(prisma, accountId);

  const count = await prisma.item.count({ where: { pageId: page.id } });
  if (count >= MAX_ITEMS) throw new ItemLimitError(MAX_ITEMS);

  return prisma.item.create({
    data: { pageId: page.id, name, description, priceCents, position: count, options: { create: options } },
    select: SELECT,
  });
}

export async function updateItem(
  prisma: PrismaClient,
  accountId: string,
  id: string,
  input: { name?: string; description?: string | null; available?: boolean; pricing?: Pricing },
): Promise<ItemRow> {
  const data: { name?: string; description?: string | null; available?: boolean; priceCents?: number | null } = {};
  if (input.name !== undefined) data.name = checkName(input.name);
  if (input.description !== undefined) data.description = checkDescription(input.description);
  if (input.available !== undefined) data.available = input.available;
  const pricing = input.pricing ? pricingData(checkPricing(input.pricing)) : null;
  if (pricing) data.priceCents = pricing.priceCents;

  const page = await storePageFor(prisma, accountId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.item.updateMany({ where: { id, pageId: page.id }, data });
    if (updated.count !== 1) throw new ItemNotFoundError();
    if (pricing) {
      await tx.itemOption.deleteMany({ where: { itemId: id } });
      if (pricing.options.length > 0) await tx.itemOption.createMany({ data: pricing.options.map((o) => ({ ...o, itemId: id })) });
    }
    return tx.item.findUniqueOrThrow({ where: { id }, select: SELECT });
  });
}

/** Returns the removed item's photo key, for the caller to delete from storage. */
export async function removeItem(prisma: PrismaClient, accountId: string, id: string): Promise<string | null> {
  const page = await storePageFor(prisma, accountId);
  return prisma.$transaction(async (tx) => {
    const item = await tx.item.findFirst({ where: { id, pageId: page.id }, select: { position: true, photoKey: true } });
    if (!item) throw new ItemNotFoundError();
    await tx.item.delete({ where: { id } });
    await tx.item.updateMany({ where: { pageId: page.id, position: { gt: item.position } }, data: { position: { decrement: 1 } } });
    return item.photoKey;
  });
}

/** The whole order at once, refused unless `ids` is exactly the current set -- reorderLinks' rule. */
export async function reorderItems(prisma: PrismaClient, accountId: string, ids: string[]): Promise<void> {
  const page = await storePageFor(prisma, accountId);
  await prisma.$transaction(async (tx) => {
    const current = await tx.item.findMany({ where: { pageId: page.id }, select: { id: true } });
    const known = new Set(current.map((item) => item.id));
    const sent = new Set(ids);
    if (sent.size !== ids.length || sent.size !== known.size || ids.some((id) => !known.has(id))) throw new ItemOrderStaleError();
    for (const [position, id] of ids.entries()) await tx.item.update({ where: { id }, data: { position } });
  });
}

/** Records the item's photo (null clears it); returns the key it replaced, for the caller to delete from storage. */
export async function setItemPhoto(prisma: PrismaClient, accountId: string, id: string, key: string | null): Promise<string | null> {
  const page = await storePageFor(prisma, accountId);
  const item = await prisma.item.findFirst({ where: { id, pageId: page.id }, select: { photoKey: true } });
  if (!item) throw new ItemNotFoundError();
  await prisma.item.update({ where: { id }, data: { photoKey: key } });
  return item.photoKey;
}

export async function clearItemPhoto(prisma: PrismaClient, accountId: string, id: string): Promise<string | null> {
  return setItemPhoto(prisma, accountId, id, null);
}
