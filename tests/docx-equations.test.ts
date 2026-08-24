import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseQuestionPaper } from "@/lib/docx-parser";
import { clearExamUploads, resolveUploadPath } from "@/lib/uploads";

/**
 * The admin's chemistry paper came through with every option showing a broken
 * image: Word had written the formulae as Equation Editor metafiles, which no
 * browser renders. This runs their actual document through the real parser and
 * checks that what lands on disk is displayable.
 */

const EXAM_ID = "eqtest001";
const SOURCE = "uploads/exams/cmt6xi7gw001ph8od3odniejy/c8ad2640-80f6-40de-8e9f-5ca23358281a.docx";

describe("a paper whose equations are Word metafiles", () => {
  it(
    "stores something a browser can show",
    { timeout: 120_000 },
    async () => {
      let docx: Buffer;
      try {
        docx = await fs.readFile(path.resolve(SOURCE));
      } catch {
        console.log("the sample document is no longer on disk — skipping");
        return;
      }

      try {
        const parsed = await parseQuestionPaper(
          new File([new Uint8Array(docx)], "paper.docx", {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
          EXAM_ID,
        );

        const images = parsed.questions.flatMap((q) => q.images);
        console.log(`questions: ${parsed.questions.length}, images: ${images.length}`);
        expect(images.length, "this paper is full of equation images").toBeGreaterThan(0);

        const byExtension = new Map<string, number>();
        for (const img of images) {
          const ext = path.extname(img.path).toLowerCase();
          byExtension.set(ext, (byExtension.get(ext) ?? 0) + 1);
        }
        console.log("stored as:", JSON.stringify([...byExtension]));

        // The whole point: nothing left in a format the browser cannot render.
        expect(byExtension.get(".wmf") ?? 0, "no WMF should survive").toBe(0);
        expect(byExtension.get(".emf") ?? 0, "no EMF should survive").toBe(0);

        // And the files are real PNGs, not empty placeholders.
        for (const img of images.slice(0, 5)) {
          const absolute = resolveUploadPath(img.path);
          expect(absolute).not.toBeNull();
          const bytes = await fs.readFile(absolute!);
          expect(bytes.subarray(0, 8).toString("hex"), `${img.path} should be a PNG`).toBe(
            "89504e470d0a1a0a",
          );
          expect(bytes.length).toBeGreaterThan(100);
        }
      } finally {
        await clearExamUploads(EXAM_ID);
      }
    },
  );
});
