import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStudent } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { secondsRemaining } from "@/lib/exam-window";

export const runtime = "nodejs";

const schema = z.object({
  type: z.enum(["TAB_SWITCH", "BLUR"]),
  sessionToken: z.string().min(1),
});

/**
 * Records that the student left the exam tab, and doubles as the countdown
 * heartbeat — the response carries the server's own time remaining, so a browser
 * that was suspended (laptop lid closed) corrects itself on return rather than
 * carrying on from a stale count.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let student;
  try {
    ({ student } = await requireStudent());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const attempt = await prisma.attempt.findUnique({ where: { id } });
  if (!attempt || attempt.studentId !== student.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (attempt.status !== "IN_PROGRESS") {
    return NextResponse.json({ ok: true, finished: true });
  }
  if (attempt.sessionToken !== parsed.data.sessionToken) {
    return NextResponse.json({ error: "Session conflict", conflict: true }, { status: 409 });
  }

  const updated = await prisma.attempt.update({
    where: { id },
    data: {
      ...(parsed.data.type === "TAB_SWITCH" ? { tabSwitchCount: { increment: 1 } } : {}),
      activityLogs: { create: { type: parsed.data.type } },
    },
    select: { tabSwitchCount: true, deadlineAt: true },
  });

  return NextResponse.json({
    ok: true,
    tabSwitchCount: updated.tabSwitchCount,
    secondsRemaining: secondsRemaining(updated),
  });
}
