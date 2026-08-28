-- The session a batch belongs to, as "2026-27".
--
-- Nullable: every batch that already exists has none, and a class running since
-- before anyone recorded a year is still a class. Roll numbers fall back to the
-- batch alone when it is absent.
ALTER TABLE "Batch" ADD COLUMN "academicYear" TEXT;
