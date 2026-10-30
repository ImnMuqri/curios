-- Shop vouchers, and what a discount did to an order.
CREATE TYPE "VoucherMode" AS ENUM ('AUTO', 'CODE');
CREATE TYPE "VoucherKind" AS ENUM ('PERCENT', 'AMOUNT');

-- An order paid in full by a voucher has nothing to collect.
ALTER TYPE "OrderPaidVia" ADD VALUE 'VOUCHER';

CREATE TABLE "ShopVoucher" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "mode" "VoucherMode" NOT NULL,
    "code" TEXT,
    "name" TEXT,
    "kind" "VoucherKind" NOT NULL,
    "percent" INTEGER,
    "amountCents" INTEGER,
    "itemId" TEXT,
    "minSpendCents" INTEGER,
    "endsAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopVoucher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShopVoucher_pageId_code_key" ON "ShopVoucher"("pageId", "code");
CREATE INDEX "ShopVoucher_pageId_idx" ON "ShopVoucher"("pageId");
CREATE INDEX "ShopVoucher_itemId_idx" ON "ShopVoucher"("itemId");

ALTER TABLE "ShopVoucher" ADD CONSTRAINT "ShopVoucher_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopVoucher" ADD CONSTRAINT "ShopVoucher_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0,
                    ADD COLUMN "voucherId" TEXT,
                    ADD COLUMN "voucherLabel" TEXT;

CREATE INDEX "Order_voucherId_idx" ON "Order"("voucherId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "ShopVoucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
