"use client";

import { CheckCircle2, Mail, MailX } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { Alert } from "@/components/ui/primitives";
import { formatRollNumber } from "@/lib/roll-number";
import type { CreatedCredential } from "./actions";

/**
 * Shown once, immediately after a student is created or their password reset.
 *
 * Passwords are stored only as bcrypt hashes, so this is the single moment the
 * plaintext exists — the copy says so plainly rather than letting an admin
 * assume they can look it up again later.
 */
export function CredentialsPanel({ credential }: { credential: CreatedCredential }) {
  const both = `Roll number: ${formatRollNumber(credential.username)}\nPassword: ${credential.password}`;

  return (
    <div className="rounded-[var(--radius-app)] border border-success bg-success-soft/40 p-4">
      <div className="mb-3 flex items-center gap-2 text-success">
        <CheckCircle2 className="size-5" />
        <p className="font-semibold">{credential.name} is ready to sign in</p>
      </div>

      <dl className="space-y-2">
        <Row
          label="Roll number"
          value={formatRollNumber(credential.username)}
          testId="credential-username"
        />
        <Row label="Password" value={credential.password} mono testId="credential-password" />
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-success/30 pt-3">
        <CopyButton value={both} label="Copy both" />
        {credential.emailed ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-success">
            <Mail className="size-3.5" /> Emailed to the student
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-warning">
            <MailX className="size-3.5" />
            {credential.emailNote ?? "Not emailed"}
          </span>
        )}
      </div>

      <Alert tone="warning" className="mt-3">
        Copy this password now. It is stored encrypted, so it cannot be shown
        again — you would have to generate a new one.
      </Alert>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  testId,
}: {
  label: string;
  value: string;
  mono?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-surface px-3 py-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="flex items-center gap-2">
        <span
          data-testid={testId}
          className={mono ? "font-mono text-sm font-semibold" : "text-sm font-semibold"}
        >
          {value}
        </span>
        <CopyButton value={value} label="" />
      </dd>
    </div>
  );
}
