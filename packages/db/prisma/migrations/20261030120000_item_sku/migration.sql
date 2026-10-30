-- The owner's own reference for an item, a SKU. Optional, and never shown in the shop.
ALTER TABLE "Item" ADD COLUMN "sku" TEXT;
