-- Whether students may download a study note, or only read it in the browser.
--
-- Defaults to true: every note already uploaded could be downloaded, and a
-- migration must not quietly take that away from material a class is using.
ALTER TABLE "Note" ADD COLUMN "allowDownload" BOOLEAN NOT NULL DEFAULT true;
