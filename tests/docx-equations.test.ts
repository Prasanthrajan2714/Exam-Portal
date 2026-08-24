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
const SOURCE_DIR = "uploads/exams/cmt6xi7gw001ph8od3odniejy";

/**
 * The stored document is named by a fresh UUID every time the paper is
 * re-uploaded, so this looks for whichever .docx is in that exam's directory
 * rather than pinning a filename that goes stale on the next upload.
 */
async function findSampleDocument(): Promise<Buffer | null> {
  try {
    const dir = path.resolve(SOURCE_DIR);
    const names = (await fs.readdir(dir)).filter((n) => n.toLowerCase().endsWith(".docx"));
    if (names.length === 0) return null;
    return await fs.readFile(path.join(dir, names[0]));
  } catch {
    return null;
  }
}

describe("a paper whose equations are Word metafiles", () => {
  it(
    "stores something a browser can show, at the size the document shows it",
    { timeout: 120_000 },
    async () => {
      const docx = await findSampleDocument();
      if (!docx) {
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
        console.log("sizes:", JSON.stringify(images.map((i) => `${i.width}x${i.height}`)));

        // These are inline formulae — Word sets them at text height, and the
        // parser has to carry that through. Rendering at the raster's own size
        // instead is what made a lone N_A x 4 fill a whole option.
        for (const img of images) {
          expect(img.width, `${img.path} has no width`).toBeGreaterThan(0);
          expect(img.height, `${img.path} has no height`).toBeGreaterThan(0);
          // Rasterised these are over a thousand pixels wide; laid out, none of
          // them is wider than a line of text or taller than about two.
          expect(img.width, `${img.path} is ${img.width}px wide`).toBeLessThan(400);
          expect(img.height, `${img.path} is ${img.height}px tall`).toBeLessThan(60);
        }

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
