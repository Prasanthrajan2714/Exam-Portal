import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Credential email. When SMTP_HOST is unset the message is printed to the server
 * console instead of being sent, so local development needs no mail server and a
 * missing SMTP config can never fail a student import.
 */

let cached: Transporter | null | undefined;

function transport(): Transporter | null {
  if (cached !== undefined) return cached;
  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    cached = null;
    return null;
  }
  cached = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return cached;
}

export type MailResult = { sent: boolean; reason?: string };

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<MailResult> {
  const t = transport();
  if (!t) {
    console.info(
      `\n[mail:console] SMTP not configured — message not sent.\n  To: ${opts.to}\n  Subject: ${opts.subject}\n${opts.text}\n`,
    );
    return { sent: false, reason: "SMTP not configured (logged to console)" };
  }
  try {
    await t.sendMail({
      from: process.env.MAIL_FROM ?? "FirstBench Exams <no-reply@firstbench.tech>",
      ...opts,
    });
    return { sent: true };
  } catch (error) {
    // A bounced email must never roll back a student that was created fine.
    console.error("[mail] send failed:", error);
    return { sent: false, reason: (error as Error).message };
  }
}

export function credentialsEmail(args: {
  name: string;
  username: string;
  password: string;
  loginUrl: string;
}) {
  const { name, username, password, loginUrl } = args;
  const text = [
    `Hello ${name},`,
    ``,
    `Your FirstBench exam portal account is ready.`,
    ``,
    `  Username: ${username}`,
    `  Password: ${password}`,
    ``,
    `Sign in at: ${loginUrl}`,
    ``,
    `Please keep these details private. You will be asked to set your own`,
    `password the first time you sign in.`,
    ``,
    `— FirstBench`,
  ].join("\n");

  // The logo is served from the portal itself; if the portal isn't reachable
  // from the student's mail client the alt text stands in for it.
  let logoUrl = "";
  try {
    logoUrl = `${new URL(loginUrl).origin}/logo.jpeg`;
  } catch {
    logoUrl = "";
  }

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;color:#14120c;background:#faf8f3;padding:24px">
      <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #eae5da;border-radius:10px;overflow:hidden">
        <div style="background:#ffc61a;padding:16px 20px">
          ${
            logoUrl
              ? `<img src="${escapeHtml(logoUrl)}" alt="FirstBench" width="36" height="36"
                   style="vertical-align:middle;border-radius:8px;background:#fff" />`
              : ""
          }
          <span style="vertical-align:middle;margin-left:10px;font-size:16px;font-weight:700;color:#17130a">FirstBench Exams</span>
        </div>
        <div style="padding:20px">
          <p style="margin-top:0">Hello ${escapeHtml(name)},</p>
          <p>Your FirstBench exam portal account is ready.</p>
          <table style="border-collapse:collapse;margin:16px 0;background:#fff6da;border-radius:8px">
            <tr><td style="padding:8px 16px 8px 12px;color:#6b6455">Username</td>
                <td style="padding:8px 12px 8px 0"><strong>${escapeHtml(username)}</strong></td></tr>
            <tr><td style="padding:8px 16px 8px 12px;color:#6b6455">Password</td>
                <td style="padding:8px 12px 8px 0"><strong>${escapeHtml(password)}</strong></td></tr>
          </table>
          <p>
            <a href="${escapeHtml(loginUrl)}"
               style="display:inline-block;background:#ffc61a;color:#17130a;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:8px">
              Sign in to the exam portal
            </a>
          </p>
          <p style="color:#6b6455">Please keep these details private. You will be asked to set
          your own password the first time you sign in.</p>
          <p style="color:#6b6455;margin-bottom:0">— FirstBench</p>
        </div>
      </div>
    </div>`;

  return { subject: "Your FirstBench exam portal login", text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
