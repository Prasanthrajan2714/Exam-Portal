import "dotenv/config";
import fs from "node:fs/promises";
import Module from "node:module";
import { createRequire } from "node:module";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

/**
 * Backfills QuestionImage.width/height for papers uploaded before the size was
 * carried through.
 *
 * Word lays an inline equation out at text height; without that size the image
 * renders at whatever it happened to be rasterised to and swamps the option it
 * belongs to. Rather than ask for every affected paper to be uploaded again,
 * this re-reads the .docx still stored beside it and takes the sizes from there.
 *
 * Safe to re-run: extracted images are content-addressed, so re-parsing writes
 * byte-identical files, and only rows that are missing a size are touched.
 *
 *   npx tsx scripts/backfill-image-sizes.ts          # report only
 *   npx tsx scripts/backfill-image-sizes.ts --apply  # write
 */

const apply = process.argv.includes("--apply");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * The parser is a server module and imports "server-only", which throws outside
 * a React Server Component. Point that specifier at the same stub the test suite
 * uses, before the module is loaded.
 */
function stubServerOnly(): void {
  const require_ = createRequire(import.meta.url);
  type Resolver = (this: unknown, request: string, ...rest: unknown[]) => string;
  const internals = Module as unknown as { _resolveFilename: Resolver };
  const original = internals._resolveFilename;
  internals._resolveFilename = function (request, ...rest) {
    if (request === "server-only") {
      return require_.resolve(path.join(process.cwd(), "tests/stubs/server-only.ts"));
    }
    return original.call(this, request, ...rest);
  };
}

async function findDocument(root: string, examId: string): Promise<Buffer | null> {
  const dir = path.join(root, "exams", examId);
  try {
    const names = (await fs.readdir(dir)).filter((n) => n.toLowerCase().endsWith(".docx"));
    if (names.length === 0) return null;
    return await fs.readFile(path.join(dir, names[0]));
  } catch {
    return null;
  }
}

async function main() {
  stubServerOnly();
  const { parseQuestionPaper } = await import("../lib/docx-parser");
  const { uploadRoot } = await import("../lib/uploads");
  const root = uploadRoot();

  const stale = await prisma.questionImage.findMany({
    where: { width: null },
    select: { id: true, path: true, question: { select: { examId: true } } },
  });

  if (stale.length === 0) {
    console.log("Nothing to do — every stored image already has its size.");
    return;
  }

  const byExam = new Map<string, typeof stale>();
  for (const row of stale) {
    const list = byExam.get(row.question.examId) ?? [];
    list.push(row);
    byExam.set(row.question.examId, list);
  }

  console.log(
    `${stale.length} image(s) without a size, across ${byExam.size} exam(s).` +
      (apply ? "" : "  (dry run — pass --apply to write)"),
  );

  let updated = 0;
  let unmatched = 0;

  for (const [examId, rows] of byExam) {
    const exam = await prisma.exam.findUnique({
      where: { id: examId },
      select: { name: true },
    });
    const label = exam?.name ?? examId;

    const docx = await findDocument(root, examId);
    if (!docx) {
      console.log(`  ${label}: no source document kept — skipped`);
      unmatched += rows.length;
      continue;
    }

    const parsed = await parseQuestionPaper(
      new File([new Uint8Array(docx)], "paper.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      examId,
    );

    const sizeByPath = new Map<string, { width: number; height: number }>();
    for (const question of parsed.questions) {
      for (const image of question.images) {
        if (image.width > 0 && image.height > 0) {
          sizeByPath.set(image.path, { width: image.width, height: image.height });
        }
      }
    }

    let hit = 0;
    for (const row of rows) {
      const size = sizeByPath.get(row.path);
      if (!size) {
        unmatched++;
        continue;
      }
      if (apply) {
        await prisma.questionImage.update({
          where: { id: row.id },
          data: { width: size.width, height: size.height },
        });
      }
      hit++;
      updated++;
    }
    console.log(`  ${label}: ${hit}/${rows.length} matched`);
  }

  console.log(
    `\n${apply ? "Updated" : "Would update"} ${updated} image(s).` +
      (unmatched ? `  ${unmatched} could not be matched and were left alone.` : ""),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
