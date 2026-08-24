-- Word lays an inline equation out at text height (its metafile says 152 x 24
-- px). Without carrying that through, the extracted image renders at whatever
-- size it was rasterised to and fills the option it belongs to.
ALTER TABLE "QuestionImage" ADD COLUMN "width" INTEGER;
ALTER TABLE "QuestionImage" ADD COLUMN "height" INTEGER;
