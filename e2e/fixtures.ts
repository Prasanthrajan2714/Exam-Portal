import { Document, Packer, Paragraph } from "docx";
import ExcelJS from "exceljs";

/** Builds the .docx / .xlsx files the acceptance test uploads. */

export async function questionPaperDocx(): Promise<Buffer> {
  const lines = [
    "[SUBJECT: Mathematics]",
    "1. What is 2 + 2?",
    "A) 3",
    "B) 4",
    "C) 5",
    "D) 6",
    "2. What is 10 divided by 2?",
    "A) 2",
    "B) 4",
    "C) 5",
    "D) 10",
    "[SUBJECT: Physics]",
    "1. What is the SI unit of force?",
    "A) Joule",
    "B) Newton",
    "C) Watt",
    "D) Pascal",
    "2. Which of these is a vector quantity?",
    "A) Speed",
    "B) Mass",
    "C) Velocity",
    "D) Time",
  ];
  const document = new Document({
    sections: [{ children: lines.map((text) => new Paragraph({ text })) }],
  });
  return Buffer.from(await Packer.toBuffer(document));
}

export async function answerKeyXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Key");
  sheet.addRow(["Subject", "Q.No", "Correct Option"]);
  sheet.addRow(["Mathematics", 1, "B"]);
  sheet.addRow(["Mathematics", 2, "C"]);
  sheet.addRow(["Physics", 1, "B"]);
  sheet.addRow(["Physics", 2, "C"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Student bulk-upload sheet, deliberately including one invalid row. */
export async function studentsXlsx(batchName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Students");
  sheet.addRow(["Name", "Phone", "Email", "School Name", "Batch"]);
  sheet.addRow(["Ravi Verma", "9876500001", "ravi@example.com", "St Josephs", batchName]);
  sheet.addRow(["Anita Desai", "9876500002", "anita@example.com", "KV Chennai", batchName]);
  // Malformed email — must be rejected in the preview without blocking the rest.
  sheet.addRow(["Broken Row", "9876500003", "not-an-email", "Nowhere", batchName]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
