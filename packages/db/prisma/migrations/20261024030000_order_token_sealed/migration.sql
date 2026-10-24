-- The order link, sealed, so delivery and resend emails sent after placing can carry it.
ALTER TABLE "Order" ADD COLUMN "tokenSealed" TEXT;
