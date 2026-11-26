-- Only a hash of the checkout attempt's key is kept. No order has been placed with the plain key outside development, so the old values are dropped, not converted.
DROP INDEX "Order_pageId_placeKey_key";
ALTER TABLE "Order" DROP COLUMN "placeKey";
ALTER TABLE "Order" ADD COLUMN "placeKeyHash" TEXT;
CREATE UNIQUE INDEX "Order_pageId_placeKeyHash_key" ON "Order"("pageId", "placeKeyHash");
