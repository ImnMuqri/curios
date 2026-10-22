import { openDays } from '@curios/core/orders';
import type { DeliveryMode } from '@curios/core/store';
import type { ShopCopy } from './copy.js';

/**
 * The shop pill's second line: "3 items · next pickup Sat 17 Oct". The day is
 * the first one `openDays` accepts. A shop that only delivers says "next
 * delivery", a paused shop (it cannot take an order) or one with no way to get
 * the order drops the day rather than promise one.
 */
export function shopPillCaption(
  shop: { pickupEnabled: boolean; deliveryMode: DeliveryMode; minNoticeDays: number; closedDays: number[]; canTakeOrders: boolean },
  itemCount: number,
  copy: ShopCopy,
  now: Date,
): string {
  const count = copy.itemCount(itemCount);
  const delivers = shop.deliveryMode !== 'NONE';
  if (!shop.canTakeOrders || (!shop.pickupEnabled && !delivers)) return count;
  const [day] = openDays({ now, minNoticeDays: shop.minNoticeDays, closedDays: shop.closedDays }, 1);
  if (!day) return count;
  return `${count} · ${shop.pickupEnabled ? copy.nextPickup(copy.dayLong(day)) : copy.nextDelivery(copy.dayLong(day))}`;
}
