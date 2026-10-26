-- What a digital line sold, copied from the item when the order is placed.
ALTER TABLE "OrderLine" ADD COLUMN "accessUrl" TEXT,
ADD COLUMN "accessNote" TEXT,
ADD COLUMN "sessionMinutes" INTEGER,
ADD COLUMN "sessionPlace" "SessionPlace",
ADD COLUMN "sessionWhere" TEXT;
