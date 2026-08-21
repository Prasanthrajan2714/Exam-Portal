import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const SUBJECTS = ["Mathematics", "Physics", "Chemistry", "Biology"];

async function main() {
  // Subjects — fixed list the exam creator picks from.
  for (const [index, name] of SUBJECTS.entries()) {
    await prisma.subject.upsert({
      where: { name },
      update: { order: index },
      create: { name, order: index },
    });
  }
  console.log(`Seeded ${SUBJECTS.length} subjects.`);

  // A single admin to bootstrap the portal.
  const username = process.env.SEED_ADMIN_USERNAME ?? "admin";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "admin123";

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`Admin "${username}" already exists — left untouched.`);
  } else {
    await prisma.user.create({
      data: {
        username,
        email: process.env.SEED_ADMIN_EMAIL ?? "admin@firstbench.tech",
        passwordHash: await bcrypt.hash(password, 10),
        role: "ADMIN",
        mustChangePassword: false,
      },
    });
    console.log(`Created admin "${username}" with password "${password}".`);
    console.log("Change this password after your first login.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
