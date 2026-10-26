import type { Prisma, PrismaClient } from '@curios/db';
import { ITEM_CATEGORY_MAX, ITEM_DESCRIPTION_MAX, ITEM_NAME_MAX, ITEM_TAG_MAX, MAX_ITEMS, pricingProblem, type Pricing } from '@curios/core/store';
import { itemSlug } from '@curios/core/slug';
import { InvalidItemError, ItemHasBookingsError, ItemHasSalesError, ItemLimitError, ItemNotFoundError, ItemOrderStaleError } from './store.errors.js';
import { DIGITAL_COLUMNS, DIGITAL_RELATIONS, NO_DIGITAL, digitalDetail, hasBookings, resolveDigital, type DigitalDetail, type DigitalFields, type DigitalInput } from './digital-item.service.js';
import { storePageFor } from './store-page.js';

export interface ItemRow extends DigitalFields, DigitalDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  tag: string | null;
  photoKey: string | null;
  available: boolean;
  priceCents: number | null;
  options: { id: string; label: string; priceCents: number }[];
}

const DIGITAL_SELECT = DIGITAL_COLUMNS;

const SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  category: true,
  tag: true,
  photoKey: true,
  available: true,
  priceCents: true,
  options: { orderBy: { position: 'asc' }, select: { id: true, label: true, priceCents: true } },
  ...DIGITAL_COLUMNS,
  ...DIGITAL_RELATIONS,
} as const;

type SelectedItem = Prisma.ItemGetPayload<{ select: typeof SELECT }>;

function toRow(row: SelectedItem): ItemRow {
  const { files: _files, sessions: _sessions, _count, ...rest } = row;
  return { ...rest, ...digitalDetail(row) };
}

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

function checkCategory(raw: string | null): string | null {
  if (raw === null) return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  if ([...text].length > ITEM_CATEGORY_MAX) throw new InvalidItemError(`Keep the category to ${ITEM_CATEGORY_MAX} characters.`);
  return text;
}

function checkTag(raw: string | null): string | null {
  if (raw === null) return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  if ([...text].length > ITEM_TAG_MAX) throw new InvalidItemError(`Keep the tag to ${ITEM_TAG_MAX} characters.`);
  return text;
}

/** A unique-constraint failure on the slug: another item took it between the read and the write. */
function slugRaced(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
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
  return (await prisma.item.findMany({ where: { pageId: page.id }, orderBy: { position: 'asc' }, select: SELECT })).map(toRow);
}

/** Appended last. Count-then-create can overshoot MAX_ITEMS by one under a race; a product limit, not a safety one -- as addLink argues. */
export async function addItem(
  prisma: PrismaClient,
  accountId: string,
  input: { name: string; description?: string | null; category?: string | null; tag?: string | null; pricing: Pricing } & DigitalInput,
): Promise<ItemRow> {
  const name = checkName(input.name);
  const description = checkDescription(input.description ?? null);
  const category = checkCategory(input.category ?? null);
  const tag = checkTag(input.tag ?? null);
  const { priceCents, options } = pricingData(checkPricing(input.pricing));
  const digital = resolveDigital(NO_DIGITAL, input);
  const page = await storePageFor(prisma, accountId);

  const count = await prisma.item.count({ where: { pageId: page.id } });
  if (count >= MAX_ITEMS) throw new ItemLimitError(MAX_ITEMS);

  // The slug is made here, once, and no update ever writes it: a renamed item
  // keeps the link that was shared. Two requests can pick the same one; the
  // unique index refuses the second, which picks again.
  for (let attempt = 0; ; attempt++) {
    const taken = new Set((await prisma.item.findMany({ where: { pageId: page.id }, select: { slug: true } })).map((row) => row.slug));
    try {
      return toRow(
        await prisma.item.create({
          data: { pageId: page.id, name, slug: itemSlug(name, taken), description, category, tag, priceCents, position: count, options: { create: options }, ...digital },
          select: SELECT,
        }),
      );
    } catch (error) {
      if (attempt >= 4 || !slugRaced(error)) throw error;
    }
  }
}

export async function updateItem(
  prisma: PrismaClient,
  accountId: string,
  id: string,
  input: { name?: string; description?: string | null; category?: string | null; tag?: string | null; available?: boolean; pricing?: Pricing } & DigitalInput,
): Promise<ItemRow> {
  // No slug here, on purpose: it is frozen at creation.
  const data: Prisma.ItemUpdateManyMutationInput = {};
  if (input.name !== undefined) data.name = checkName(input.name);
  if (input.description !== undefined) data.description = checkDescription(input.description);
  if (input.category !== undefined) data.category = checkCategory(input.category);
  if (input.tag !== undefined) data.tag = checkTag(input.tag);
  if (input.available !== undefined) data.available = input.available;
  const pricing = input.pricing ? pricingData(checkPricing(input.pricing)) : null;
  if (pricing) data.priceCents = pricing.priceCents;
  const touchesDigital = (['kind', 'delivery', 'accessUrl', 'accessNote', 'sessionMinutes', 'sessionPlace', 'sessionWhere'] as const).some((key) => input[key] !== undefined);

  const page = await storePageFor(prisma, accountId);
  return prisma.$transaction(async (tx) => {
    if (touchesDigital) {
      // Merged with what the item holds now, so a PATCH of one field is judged against the whole.
      const current = await tx.item.findFirst({ where: { id, pageId: page.id }, select: DIGITAL_SELECT });
      if (!current) throw new ItemNotFoundError();
      Object.assign(data, resolveDigital(current, input));
    }
    const updated = await tx.item.updateMany({ where: { id, pageId: page.id }, data });
    if (updated.count !== 1) throw new ItemNotFoundError();
    if (pricing) {
      await tx.itemOption.deleteMany({ where: { itemId: id } });
      if (pricing.options.length > 0) await tx.itemOption.createMany({ data: pricing.options.map((o) => ({ ...o, itemId: id })) });
    }
    return toRow(await tx.item.findUniqueOrThrow({ where: { id }, select: SELECT }));
  });
}

/** Returns the removed item's photo key and file keys, for the caller to delete from storage. */
export async function removeItem(prisma: PrismaClient, accountId: string, id: string): Promise<{ photoKey: string | null; fileKeys: string[] }> {
  const page = await storePageFor(prisma, accountId);
  return prisma.$transaction(async (tx) => {
    const item = await tx.item.findFirst({ where: { id, pageId: page.id }, select: { position: true, photoKey: true, files: { select: { key: true } } } });
    if (!item) throw new ItemNotFoundError();
    // The foreign key only objects at commit; refuse here, with a sentence.
    if (await hasBookings(tx, id)) throw new ItemHasBookingsError();
    // The codes cascade with the item; the ones buyers were given, or an unpaid order holds, are theirs.
    if ((await tx.itemCode.count({ where: { itemId: id, orderLineId: { not: null } } })) > 0) throw new ItemHasSalesError();
    await tx.item.delete({ where: { id } });
    await tx.item.updateMany({ where: { pageId: page.id, position: { gt: item.position } }, data: { position: { decrement: 1 } } });
    return { photoKey: item.photoKey, fileKeys: item.files.map((f) => f.key) };
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
