-- A source read from an uploaded file: its name, for the Sources list. The text
-- itself goes in "pastedText", so "Ingestion_one_source" still holds unchanged.
ALTER TABLE "Ingestion" ADD COLUMN "fileName" TEXT;
