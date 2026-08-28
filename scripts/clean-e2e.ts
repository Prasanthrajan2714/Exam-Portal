import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

/**
 * Removes everything the acceptance journey creates.
 *
 * The suite stamps each run so it can be re-run without a clean database, which
 * is convenient and means the leftovers pile up: after twenty runs there are
 * twenty spare classes in every batch dropdown and twenty Ravi Vermas in the
 * student list, on the same database an admin is using.
 *
 * Run with: npx tsx scripts/clean-e2e.ts
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const batches = await prisma.batch.findMany({
    where: { name: { startsWith: "E2E Batch " } },
    select: { id: true },
  });
  const ids = batches.map((b) => b.id);
  if (ids.length === 0) {
    console.log("No E2E data to clean.");
    return;
  }

  // In dependency order: an exam holds questions and attempts, a student holds
  // a login, and a batch refuses to go while any of them still point at it.
  const exams = await prisma.exam.deleteMany({ where: { batchId: { in: ids } } });

  const students = await prisma.student.findMany({
    where: { batchId: { in: ids } },
    select: { userId: true },
  });
  await prisma.student.deleteMany({ where: { batchId: { in: ids } } });
  await prisma.user.deleteMany({
    where: { id: { in: students.map((s) => s.userId) } },
  });

  const notes = await prisma.note.deleteMany({ where: { batchId: { in: ids } } });
  const gone = await prisma.batch.deleteMany({ where: { id: { in: ids } } });

  console.log(
    `Cleaned ${gone.count} batch(es), ${exams.count} exam(s), ` +
      `${students.length} student(s), ${notes.count} note(s).`,
  );
}

main().finally(() => prisma.$disconnect());
