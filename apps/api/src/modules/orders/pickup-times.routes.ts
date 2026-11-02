import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isOrderDay } from '@curios/core/orders';
import type { PrismaClient } from '@curios/db';
import { PageNotFoundError } from '../chat/chat.service.js';
import { PageUnavailableError } from '../pages/page-unavailable.js';
import { StoreBusinessOnlyError } from '../store/store.errors.js';
import { MethodOffError, OrderDateError, PickupPlaceRequiredError, StoreClosedError } from './order.errors.js';

export interface PickupTime {
  id: string;
  from: number;
  to: number;
  full: boolean;
}

/**
 * A place's times on one day, each saying whether its limit is reached. Only a
 * guide for checkout's chips: placing the order counts again under the page
 * lock, and that count is the one that decides (PICKUP_TIME_FULL).
 */
export async function pickupTimes(prisma: PrismaClient, handle: string, placeId: string, day: string, now: Date): Promise<PickupTime[]> {
  const page = await prisma.page.findUnique({
    where: { handle: handle.toLowerCase(), published: true },
    select: { id: true, mode: true, storeEnabled: true, pickupEnabled: true, minNoticeDays: true, closedDays: true, suspendedAt: true },
  });
  if (!page) throw new PageNotFoundError();
  if (page.suspendedAt !== null) throw new PageUnavailableError();
  if (page.mode !== 'BUSINESS') throw new StoreBusinessOnlyError();
  if (!page.storeEnabled) throw new StoreClosedError();
  if (!page.pickupEnabled) throw new MethodOffError('PICKUP');
  // Before the windows: a day the shop does not take has no times to ask about.
  if (!isOrderDay(day, { now, minNoticeDays: page.minNoticeDays, closedDays: page.closedDays })) throw new OrderDateError();

  const place = await prisma.pickupPlace.findFirst({
    where: { id: placeId, pageId: page.id },
    select: { windows: { orderBy: { position: 'asc' }, select: { id: true, fromMinute: true, toMinute: true, limit: true } } },
  });
  if (!place) throw new PickupPlaceRequiredError();
  // An any-time place has no windows, so there is nothing to count.
  const capped = place.windows.filter((w) => w.limit !== null).map((w) => w.id);
  const counts =
    capped.length === 0
      ? []
      : await prisma.order.groupBy({
          by: ['pickupWindowId'],
          where: { pickupWindowId: { in: capped }, day: new Date(`${day}T00:00:00Z`), status: { not: 'CANCELLED' } },
          _count: { _all: true },
        });
  const taken = new Map(counts.map((c) => [c.pickupWindowId, c._count._all]));
  return place.windows.map((w) => ({
    id: w.id,
    from: w.fromMinute,
    to: w.toMinute,
    full: w.limit !== null && (taken.get(w.id) ?? 0) >= w.limit,
  }));
}

const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** Checkout asking which of a place's times are full on a day. Anonymous, per-IP budget (app.ts). */
export const pickupTimesRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/store/:handle/pickup-times',
    {
      schema: {
        params: z.object({ handle: z.string().min(1).max(64) }),
        // The day's shape is isOrderDay's to judge, so a bad one gets ORDER_DATE as at placing.
        querystring: z.object({ place: z.string().min(1).max(64), day: z.string().max(10) }),
        response: {
          200: z.object({ windows: z.array(z.object({ id: z.string(), from: z.number(), to: z.number(), full: z.boolean() })) }),
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          410: errorSchema,
        },
      },
    },
    async (request) => ({
      windows: await pickupTimes(app.prisma, request.params.handle, request.query.place, request.query.day, new Date()),
    }),
  );
};
