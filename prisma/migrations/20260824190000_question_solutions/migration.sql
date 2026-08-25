-- A paper carries its own worked solutions, shown to the batch once the exam
-- window closes. solvedOption is the answer the solution itself reaches, kept
-- apart from correctOption so the two can be compared: a paper cannot be
-- published while the uploaded answer key and its own solution disagree.
ALTER TABLE "Question" ADD COLUMN "solution" TEXT;
ALTER TABLE "Question" ADD COLUMN "solvedOption" "OptionKey";
