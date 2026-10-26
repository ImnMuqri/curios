-- DropForeignKey
ALTER TABLE "SessionBooking" DROP CONSTRAINT "SessionBooking_sessionId_fkey";

-- AddForeignKey
-- NO ACTION alone is still checked per cascaded delete, so deleting an Account (Page -> Item ->
-- ItemSession, and Page -> Order -> OrderLine -> SessionBooking) tripped it. DEFERRABLE INITIALLY
-- DEFERRED checks at commit, by which time the booking is gone; a lone delete still fails.
-- Prisma cannot express DEFERRABLE, so it lives only here.
ALTER TABLE "SessionBooking" ADD CONSTRAINT "SessionBooking_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ItemSession"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
