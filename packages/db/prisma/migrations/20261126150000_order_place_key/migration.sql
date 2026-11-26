-- An order placed twice by the same checkout attempt (a lost response, then a retry) is one order.
ALTER TABLE "Order" ADD COLUMN "placeKey" TEXT;
CREATE UNIQUE INDEX "Order_pageId_placeKey_key" ON "Order"("pageId", "placeKey");
