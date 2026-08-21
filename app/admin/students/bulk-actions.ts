"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { type ActionResult, authErrorMessage, fail, ok } from "@/lib/action-result";
import { generatePassword, hashPassword, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { credentialsEmail, sendMail } from "@/lib/mailer";
import { generateUsername } from "@/lib/username";
import { readFirstSheet } from "@/lib/xlsx";

/**
 * Bulk student import. Deliberately two-step: the upload is *parsed and
 * validated* first and shown back to the admin, and only a second explicit
 * action writes anything. A spreadsheet with a typo in one row should never
 * half-import.
 */

export type ParsedStudentRow = {
  rowNumber: number;
  name: string;
  phone: string;
  email: string;
  schoolName: string;
  batchName: string;
  /** Resolved during validation; null when the batch name did not match. */
  batchId: string | null;
  username: string;
  errors: string[];
};

export type ParseResult = {
  rows: ParsedStudentRow[];
  validCount: number;
  errorCount: number;
};

const HEADER_ALIASES: Record<string, string[]> = {
  name: ["name", "studentname", "fullname"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "contact"],
  email: ["email", "emailid", "emailaddress", "mail"],
  schoolName: ["school", "schoolname", "institution"],
  batchName: ["batch", "class", "batchclass", "classbatch", "batchname", "classname"],
};

function pick(data: Record<string, string>, field: keyof typeof HEADER_ALIASES): string {
  for (const alias of HEADER_ALIASES[field]) {
    if (data[alias]) return data[alias];
  }
  return "";
}

export async function parseStudentSheet(
  formData: FormData,
): Promise<ActionResult<ParseResult>> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return fail("Choose an .xlsx file to upload.");
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return fail("Only .xlsx files are supported. Save your sheet as Excel Workbook (.xlsx).");
  }

  let sheet;
  try {
    sheet = await readFirstSheet(await file.arrayBuffer());
  } catch {
    return fail("That file could not be read as an Excel workbook.");
  }

  if (sheet.rows.length === 0) {
    return fail("The first sheet has no data rows below the header.");
  }
  if (sheet.rows.length > 1000) {
    return fail("Please upload at most 1000 students at a time.");
  }

  const batches = await prisma.batch.findMany({ where: { active: true } });
  const batchByName = new Map(batches.map((b) => [b.name.toLowerCase(), b]));

  // Names generated in this run aren't in the database yet, so track them here
  // to stop two identically-named students colliding on the same username.
  const reservedUsernames = new Set<string>();
  const seenEmails = new Set<string>();

  const rows: ParsedStudentRow[] = [];
  for (const { rowNumber, data } of sheet.rows) {
    const name = pick(data, "name");
    const phone = pick(data, "phone");
    const email = pick(data, "email");
    const schoolName = pick(data, "schoolName");
    const batchName = pick(data, "batchName");

    const errors: string[] = [];

    if (name.length < 2) errors.push("Name is missing");
    if (email && !z.string().email().safeParse(email).success) {
      errors.push("Email is not valid");
    }
    if (phone && !/^[0-9+\-\s()]{6,20}$/.test(phone)) {
      errors.push("Phone number is not valid");
    }

    const batch = batchName ? batchByName.get(batchName.toLowerCase()) : undefined;
    if (!batchName) errors.push("Batch is missing");
    else if (!batch) errors.push(`No active batch named "${batchName}"`);

    if (email) {
      const key = email.toLowerCase();
      if (seenEmails.has(key)) errors.push("Duplicate email in this file");
      else seenEmails.add(key);
    }

    let username = "";
    if (name.length >= 2) {
      username = await generateUsername(name, reservedUsernames);
      reservedUsernames.add(username);
    }

    rows.push({
      rowNumber,
      name,
      phone,
      email,
      schoolName,
      batchName,
      batchId: batch?.id ?? null,
      username,
      errors,
    });
  }

  const validCount = rows.filter((r) => r.errors.length === 0).length;
  return ok(
    `${sheet.rows.length} row(s) read.`,
    { rows, validCount, errorCount: rows.length - validCount },
  );
}

export type ImportSummary = {
  imported: number;
  skipped: number;
  emailed: number;
  credentials: {
    name: string;
    username: string;
    password: string;
    email: string;
    batchName: string;
  }[];
};

/**
 * Writes the rows that passed validation. Rows with errors are skipped rather
 * than blocking the whole import — the admin has already seen exactly which
 * ones will be left out.
 */
export async function importStudents(
  rows: ParsedStudentRow[],
): Promise<ActionResult<ImportSummary>> {
  try {
    await requireAdmin();
  } catch (error) {
    return fail(authErrorMessage(error) ?? "Not allowed");
  }

  const valid = rows.filter((r) => r.errors.length === 0 && r.batchId);
  if (valid.length === 0) return fail("No valid rows to import.");

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = `${proto}://${host}/login`;

  const credentials: ImportSummary["credentials"] = [];
  let imported = 0;

  for (const row of valid) {
    const password = generatePassword();
    const passwordHash = await hashPassword(password);

    // Re-resolve the username at write time: another import may have taken it
    // between validation and confirmation.
    const username = await generateUsername(
      row.name,
      new Set(credentials.map((c) => c.username)),
    );

    try {
      await prisma.student.create({
        data: {
          name: row.name,
          phone: row.phone || null,
          email: row.email || null,
          schoolName: row.schoolName || null,
          batch: { connect: { id: row.batchId! } },
          user: {
            create: {
              username,
              email: row.email || null,
              passwordHash,
              role: "STUDENT",
              mustChangePassword: true,
            },
          },
        },
      });
    } catch {
      // A single bad row must not abort the rest of the import.
      continue;
    }

    imported++;
    credentials.push({
      name: row.name,
      username,
      password,
      email: row.email,
      batchName: row.batchName,
    });
  }

  let emailed = 0;
  for (const c of credentials) {
    if (!c.email) continue;
    const mail = credentialsEmail({
      name: c.name,
      username: c.username,
      password: c.password,
      loginUrl: url,
    });
    const result = await sendMail({ to: c.email, ...mail });
    if (result.sent) emailed++;
  }

  revalidatePath("/admin/students");
  return ok(
    `Imported ${imported} student(s).`,
    {
      imported,
      skipped: rows.length - imported,
      emailed,
      credentials,
    },
  );
}
