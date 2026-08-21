import { Download, Eye, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
} from "@/components/ui/primitives";
import { requireStudent } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatFileSize } from "@/lib/uploads";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Study Notes · FirstBench" };

/** Notes with no subject still need a heading to sit under. */
const GENERAL = "General material";

export default async function StudentNotesPage() {
  const { student } = await requireStudent();

  // Scoped to the student's own batch — the file route re-checks the same rule,
  // so a guessed note id from another class is still refused.
  const notes = await prisma.note.findMany({
    where: { batchId: student.batchId, active: true },
    orderBy: { uploadedAt: "desc" },
    include: { subject: { select: { name: true, order: true } } },
  });

  const groups = new Map<string, typeof notes>();
  for (const note of notes) {
    const key = note.subject?.name ?? GENERAL;
    const bucket = groups.get(key);
    if (bucket) bucket.push(note);
    else groups.set(key, [note]);
  }

  // Subjects in the order the admin arranged them, with the untagged pile last.
  const sections = [...groups.entries()].sort(([a, aNotes], [b, bNotes]) => {
    if (a === GENERAL) return 1;
    if (b === GENERAL) return -1;
    const order = (aNotes[0].subject?.order ?? 0) - (bNotes[0].subject?.order ?? 0);
    return order !== 0 ? order : a.localeCompare(b);
  });

  return (
    <>
      <PageHeader
        title="Study notes"
        description={`Material your teachers have shared with ${student.batch.name}. Open it here or download a copy.`}
      />

      {notes.length === 0 ? (
        <EmptyState
          title="Nothing shared yet"
          description="When your teacher uploads notes or study material for your class, it will appear here."
        />
      ) : (
        <div className="space-y-6">
          {sections.map(([subject, items]) => (
            <Card key={subject}>
              <CardHeader className="flex items-center justify-between gap-2">
                <CardTitle>{subject}</CardTitle>
                <span className="text-xs text-muted-foreground">
                  {items.length} {items.length === 1 ? "file" : "files"}
                </span>
              </CardHeader>
              <CardBody className="divide-y divide-border p-0">
                {items.map((note) => (
                  <div
                    key={note.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="font-medium">{note.title}</p>
                        {note.description && (
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {note.description}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          PDF · {formatFileSize(note.fileSize)} ·{" "}
                          {formatDate(note.uploadedAt)}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {/* New tab rather than an embedded viewer: the browser's
                          own PDF reader handles zoom, search and printing. */}
                      <Button asChild variant="secondary" size="sm">
                        <a
                          href={`/api/notes/${note.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Eye /> View
                        </a>
                      </Button>
                      <Button asChild size="sm">
                        <a href={`/api/notes/${note.id}?download=1`}>
                          <Download /> Download
                        </a>
                      </Button>
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
