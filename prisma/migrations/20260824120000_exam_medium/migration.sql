-- A paper can be sat in Tamil. The translation happens once at upload and is
-- stored, so the exam screen stays a single language and no student waits on a
-- translation call. The English it came from is kept alongside, so a term can
-- be checked or re-translated without re-reading the Word document.

CREATE TYPE "ExamMedium" AS ENUM ('ENGLISH', 'TAMIL');

ALTER TABLE "Exam" ADD COLUMN "medium" "ExamMedium" NOT NULL DEFAULT 'ENGLISH';

ALTER TABLE "Question" ADD COLUMN "sourceText" TEXT;
ALTER TABLE "Question" ADD COLUMN "sourceOptionA" TEXT;
ALTER TABLE "Question" ADD COLUMN "sourceOptionB" TEXT;
ALTER TABLE "Question" ADD COLUMN "sourceOptionC" TEXT;
ALTER TABLE "Question" ADD COLUMN "sourceOptionD" TEXT;
