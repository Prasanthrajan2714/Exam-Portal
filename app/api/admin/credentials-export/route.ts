import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { buildWorkbook, xlsxHeaders } from "@/lib/xlsx";

export const runtime = "nodejs";

const schema = z.object({
  credentials: z
    .array(
      z.object({
        name: z.string(),
        username: z.string(),
        password: z.string(),
        email: z.string().optional().default(""),
        batchName: z.string().optional().default(""),
      }),
    )
    .min(1)
    .max(1000),
});

/**
 * Turns the credential list from a bulk import into an .xlsx the admin can keep.
 * Passwords are only ever held in plaintext at creation time, so this download
 * is the admin's one chance to record them.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const buffer = await buildWorkbook(
    "Credentials",
    [
      { header: "Name", key: "name", width: 26 },
      { header: "Username", key: "username", width: 20 },
      { header: "Password", key: "password", width: 16 },
      { header: "Email", key: "email", width: 30 },
      { header: "Batch", key: "batch", width: 20 },
    ],
    parsed.data.credentials.map((c) => ({
      name: c.name,
      username: c.username,
      password: c.password,
      email: c.email,
      batch: c.batchName,
    })),
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: xlsxHeaders("firstbench-student-credentials.xlsx"),
  });
}
