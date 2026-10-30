-- An uploaded cover's colours at its top and foot, for the phone's bars on the shop's pages.
ALTER TABLE "Page" ADD COLUMN "coverTop" TEXT,
                   ADD COLUMN "coverBottom" TEXT;
