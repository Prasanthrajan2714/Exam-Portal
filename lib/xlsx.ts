import "server-only";
import ExcelJS from "exceljs";

/**
 * Thin wrappers over ExcelJS shared by student bulk upload, answer-key import
 * and results export.
 */

export type SheetRow = Record<string, string>;

/** Normalises a header cell so "Phone Number", "phone_number" and "PHONE" all match. */
export function normaliseHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, "");
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    // Rich text, hyperlinks and formula results all arrive as objects, and
    // ExcelJS types them as a union no single shape covers.
    const v = value as unknown as Record<string, unknown>;
    if ("text" in v) return String(v.text).trim();
    if ("result" in v) return String(v.result).trim();
    if ("richText" in v && Array.isArray(v.richText)) {
      return v.richText.map((r) => String((r as { text: string }).text)).join("").trim();
    }
    if ("hyperlink" in v) return String(v.hyperlink).trim();
  }
  return String(value).trim();
}

/**
 * Reads the first worksheet into plain objects keyed by normalised header.
 * Fully blank rows are skipped so trailing empty rows in a spreadsheet don't
 * turn into empty students.
 */
export async function readFirstSheet(
  buffer: ArrayBuffer | Buffer,
): Promise<{ headers: string[]; rows: { rowNumber: number; data: SheetRow }[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = normaliseHeader(cell.value);
  });

  const rows: { rowNumber: number; data: SheetRow }[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const data: SheetRow = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const text = cellToString(row.getCell(index + 1).value);
      data[header] = text;
      if (text) hasValue = true;
    });
    if (hasValue) rows.push({ rowNumber, data });
  });

  return { headers: headers.filter(Boolean), rows };
}

export type ExportColumn = { header: string; key: string; width?: number };

export type ExportRow = Record<string, string | number | null | undefined>;

export type WorkbookSheet = {
  name: string;
  columns: ExportColumn[];
  rows: ExportRow[];
};

/**
 * Excel rejects a worksheet name longer than 31 characters, containing any of
 * []:*?/\ or duplicated within the workbook. Exam names are admin-typed free
 * text, so every generated tab name goes through here.
 */
function safeSheetName(name: string, used: Set<string>): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim();
  const base = (cleaned || "Sheet").slice(0, 31);

  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function addStyledSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: ExportColumn[],
  rows: ExportRow[],
): void {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? Math.max(14, c.header.length + 4),
  }));

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFEEF2FF" },
  };
  sheet.getRow(1).border = {
    bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
  };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of rows) sheet.addRow(row);
}

function newWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "FirstBench Exam Portal";
  workbook.created = new Date();
  return workbook;
}

/** Builds a styled single-sheet workbook and returns it as a Buffer. */
export async function buildWorkbook(
  sheetName: string,
  columns: ExportColumn[],
  rows: ExportRow[],
): Promise<Buffer> {
  const workbook = newWorkbook();
  addStyledSheet(workbook, safeSheetName(sheetName, new Set()), columns, rows);

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

/**
 * Same styling as `buildWorkbook`, one tab per entry — used by the class-wise
 * report, where an admin wants every closed exam of a batch in one file rather
 * than downloading them one at a time.
 */
export async function buildMultiSheetWorkbook(
  sheets: WorkbookSheet[],
): Promise<Buffer> {
  const workbook = newWorkbook();
  const used = new Set<string>();

  for (const sheet of sheets) {
    addStyledSheet(
      workbook,
      safeSheetName(sheet.name, used),
      sheet.columns,
      sheet.rows,
    );
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** Standard headers for the download-as-file response. */
export function xlsxHeaders(filename: string): HeadersInit {
  return {
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
}
