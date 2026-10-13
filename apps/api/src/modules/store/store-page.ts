import type { PrismaClient } from '@curios/db';
import { NoPageError } from '../pages/page.service.js';
import { StoreBusinessOnlyError } from './store.errors.js';

/**
 * The owner's page, if it may have a shop. Every store route starts here, so
 * "business only" is one check in one place rather than one per handler.
 */
export async function storePageFor(prisma: PrismaClient, accountId: string): Promise<{ id: string }> {
  const page = await prisma.page.findUnique({ where: { accountId }, select: { id: true, mode: true } });
  if (!page) throw new NoPageError();
  if (page.mode !== 'BUSINESS') throw new StoreBusinessOnlyError();
  return { id: page.id };
}
