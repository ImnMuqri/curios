import { openDays } from '@curios/core/orders';
import type { DeliveryMode } from '@curios/core/store';
import type { ShopCopy } from './copy.js';

type Ordering = { pickupEnabled: boolean; deliveryMode: DeliveryMode; minNoticeDays: number; closedDays: number[]; canTakeOrders: boolean };

/**
 * The first day an order could be for (`openDays`, Malaysia time), or null
 * when the shop is paused or has no way to get the order to anyone: a day is
 * never promised that the shop cannot keep.
 */
export function nextOrderDay(shop: Ordering, now: Date): string | null {
  if (!shop.canTakeOrders || (!shop.pickupEnabled && shop.deliveryMode === 'NONE')) return null;
  const [day] = openDays({ now, minNoticeDays: shop.minNoticeDays, closedDays: shop.closedDays }, 1);
  return day ?? null;
}

/**
 * The shop pill's second line: "3 items · next pickup Sat 17 Oct". The day is
 * the first one `openDays` accepts. A shop that only delivers says "next
 * delivery", a paused shop (it cannot take an order) or one with no way to get
 * the order drops the day rather than promise one.
 */
export function shopPillCaption(
  shop: Ordering,
  itemCount: number,
  copy: ShopCopy,
  now: Date,
): string {
  const count = copy.itemCount(itemCount);
  const day = nextOrderDay(shop, now);
  if (!day) return count;
  return `${count} · ${shop.pickupEnabled ? copy.nextPickup(copy.dayLong(day)) : copy.nextDelivery(copy.dayLong(day))}`;
}
