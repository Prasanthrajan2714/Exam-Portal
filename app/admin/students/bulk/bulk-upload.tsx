"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import {
  type ImportSummary,
  type ParsedStudentRow,
  importStudents,
  parseStudentSheet,
} from "../bulk-actions";

type Step = "upload" | "preview" | "done";

export function BulkUpload() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [rows, setRows] = useState<ParsedStudentRow[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const validCount = rows.filter((r) => r.errors.length === 0).length;
  const errorCount = rows.length - validCount;

  function onParse(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await parseStudentSheet(formData);
      if (!result.ok || !result.data) {
        setError(result.message ?? "Could not read that file.");
        return;
      }
      setRows(result.data.rows);
      setStep("preview");
    });
  }

  function onImport() {
    startTransition(async () => {
      const result = await importStudents(rows);
      if (!result.ok || !result.data) {
        toast.error(result.message ?? "Import failed.");
        return;
      }
      setSummary(result.data);
      setStep("done");
      router.refresh();
    });
  }

  async function downloadCredentials() {
    if (!summary) return;
    const response = await fetch("/api/admin/credentials-export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials: summary.credentials }),
    });
    if (!response.ok) {
      toast.error("Could not build the credentials file.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "firstbench-student-credentials.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ------------------------------------------------------------- step 3
  if (step === "done" && summary) {
    return (
      <Card>
        <CardBody>
          <div className="mb-4 flex items-center gap-3">
            <CheckCircle2 className="size-6 text-success" />
            <div>
              <p className="font-semibold">Import complete</p>
              <p className="text-sm text-muted-foreground">
                {summary.imported} student{summary.imported === 1 ? "" : "s"} added
                {summary.emailed > 0 && `, ${summary.emailed} emailed their login`}.
              </p>
            </div>
          </div>

          <Alert tone="warning" className="mb-4">
            Download the credentials sheet now. Passwords are stored encrypted, so
            this file is the only record of them — after leaving this page you can
            only issue new passwords, not recover these.
          </Alert>

          <div className="mb-4 flex flex-wrap gap-2">
            <Button onClick={downloadCredentials}>
              <Download /> Download credentials (.xlsx)
            </Button>
            <Button asChild variant="secondary">
              <Link href="/admin/students">Go to students</Link>
            </Button>
          </div>

          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Roll number</Th>
                <Th>Password</Th>
                <Th>Batch</Th>
              </tr>
            </thead>
            <tbody>
              {summary.credentials.map((c) => (
                <tr key={c.username}>
                  <Td>{c.name}</Td>
                  <Td className="font-mono text-xs">{c.username}</Td>
                  <Td className="font-mono text-xs font-semibold">{c.password}</Td>
                  <Td className="text-muted-foreground">{c.batchName}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    );
  }

  // ------------------------------------------------------------- step 2
  if (step === "preview") {
    return (
      <>
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Stat label="Rows read" value={rows.length} hint={fileName} />
          <Stat label="Will be imported" value={validCount} tone="success" />
          <Stat
            label="Will be skipped"
            value={errorCount}
            tone={errorCount > 0 ? "danger" : undefined}
          />
        </div>

        {errorCount > 0 && (
          <Alert tone="warning" className="mb-4" title="Some rows have problems">
            Rows marked below will be skipped. Everything else still imports — fix
            those rows in your spreadsheet and upload again if you need them.
          </Alert>
        )}

        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Review before importing</CardTitle>
          </CardHeader>
          <Table>
            <thead>
              <tr>
                <Th>Row</Th>
                <Th>Name</Th>
                <Th>Roll number</Th>
                <Th>Batch</Th>
                <Th>Contact</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const bad = row.errors.length > 0;
                return (
                  <tr key={row.rowNumber} className={bad ? "bg-danger-soft/30" : ""}>
                    <Td className="tabular-nums text-muted-foreground">
                      {row.rowNumber}
                    </Td>
                    <Td className="font-medium">{row.name || "—"}</Td>
                    <Td className="font-mono text-xs">{row.username || "—"}</Td>
                    <Td className="text-muted-foreground">{row.batchName || "—"}</Td>
                    <Td className="text-xs text-muted-foreground">
                      {row.email || row.phone || "—"}
                    </Td>
                    <Td>
                      {bad ? (
                        <div className="flex items-start gap-1.5 text-danger">
                          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                          <span className="text-xs">{row.errors.join("; ")}</span>
                        </div>
                      ) : (
                        <Badge tone="success">Ready</Badge>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onImport} disabled={pending || validCount === 0}>
            {pending && <Loader2 className="animate-spin" />}
            Import {validCount} student{validCount === 1 ? "" : "s"}
          </Button>
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => {
              setStep("upload");
              setRows([]);
              formRef.current?.reset();
            }}
          >
            <ArrowLeft /> Choose a different file
          </Button>
        </div>
      </>
    );
  }

  // ------------------------------------------------------------- step 1
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader>
          <CardTitle>Upload your spreadsheet</CardTitle>
        </CardHeader>
        <CardBody>
          {error && (
            <Alert tone="danger" className="mb-4">
              {error}
            </Alert>
          )}

          <form ref={formRef} action={onParse} className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-app)] border-2 border-dashed border-border-strong bg-surface-muted/50 px-6 py-10 text-center transition-colors hover:border-primary hover:bg-primary-soft/30">
              <FileSpreadsheet className="mb-3 size-8 text-muted-foreground" />
              <span className="font-medium">
                {fileName || "Choose an .xlsx file"}
              </span>
              <span className="mt-1 text-sm text-muted-foreground">
                Up to 1000 students at a time
              </span>
              <input
                type="file"
                name="file"
                accept=".xlsx"
                required
                className="sr-only"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
              />
            </label>

            <Button type="submit" disabled={pending || !fileName}>
              {pending ? <Loader2 className="animate-spin" /> : <Upload />}
              Read the file
            </Button>
            <p className="text-xs text-muted-foreground">
              Nothing is saved yet — you will see exactly what will be imported
              before anything is written.
            </p>
          </form>
        </CardBody>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Required format</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4 text-sm">
          <Button asChild variant="secondary" className="w-full">
            <a href="/api/templates/students">
              <Download /> Download sample file
            </a>
          </Button>

          <div>
            <p className="mb-2 font-medium">Columns, in the first row:</p>
            <ul className="space-y-1.5 text-muted-foreground">
              <li>
                <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                  Name
                </code>{" "}
                — required
              </li>
              <li>
                <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                  Phone
                </code>
              </li>
              <li>
                <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                  Email
                </code>{" "}
                — login is emailed here
              </li>
              <li>
                <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                  School Name
                </code>
              </li>
              <li>
                <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">
                  Batch
                </code>{" "}
                — required, must match an existing batch name exactly
              </li>
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">
            Roll numbers and passwords are generated for you — do not include them.
            Column order does not matter, and headers are matched loosely, so
            “Phone Number” and “Mobile” both work.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
