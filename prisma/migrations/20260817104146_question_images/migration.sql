-- CreateEnum
CREATE TYPE "ImageTarget" AS ENUM ('STEM', 'A', 'B', 'C', 'D');

-- CreateTable
CREATE TABLE "QuestionImage" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "target" "ImageTarget" NOT NULL DEFAULT 'STEM',
    "path" TEXT NOT NULL,
    "alt" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuestionImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionImage_questionId_idx" ON "QuestionImage"("questionId");

-- AddForeignKey
ALTER TABLE "QuestionImage" ADD CONSTRAINT "QuestionImage_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
