-- The words either side of a fact's excerpt in its source, for Review's line: the excerpt picked out, the rest around it.
ALTER TABLE "Fact" ADD COLUMN "sourceBefore" TEXT;
ALTER TABLE "Fact" ADD COLUMN "sourceAfter" TEXT;
