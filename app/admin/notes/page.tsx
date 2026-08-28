import { Download, DownloadCloud, Eye, Lock, LockOpen, Trash2 } from "lucide-react";
import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui/primitives";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatFileSize } from "@/lib/uploads";
import { formatDate } from "@/lib/utils";
import { deleteNote, setNoteActive, setNoteDownloadable } from "./actions";
import { NoteFormDialog } from "./note-form";

export const metadata = { title: "Study Notes · Admin" };

export default async function AdminNotesPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string }>;
}) {
  await requireAdmin();
  const { batch = "" } = await searchParams;

  const [batches, subjects, notes] = await Promise.all([
    prisma.batch.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.subject.findMany({
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    prisma.note.findMany({
      where: batch ? { batchId: batch } : {},
      orderBy: { uploadedAt: "desc" },
      include: {
        batch: { select: { name: true } },
        subject: { select: { name: true } },
      },
      take: 500,
    }),
  ]);

  const noBatches = batches.length === 0;

  return (
    <>
      <PageHeader
        title="Study notes & material"
        description="Reference material you share with a whole batch. Students can read and download it, nothing more."
        actions={
          !noBatches && (
            <NoteFormDialog
              batches={batches}
              subjects={subjects}
              defaultBatchId={batch || undefined}
            />
          )
        }
      />

      {noBatches ? (
        <EmptyState
          title="Create a batch first"
          description="Study material is shared with a batch or class, so there has to be one to share it with."
          action={
            <Button asChild>
              <Link href="/admin/batches">Go to batches</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Plain GET form: the filter lives in the URL, so it survives a
              refresh and the upload dialog can default to the same batch. */}
          <form
            method="get"
            className="mb-4 flex flex-wrap items-end gap-3 rounded-[var(--radius-app)] border border-border bg-surface p-3"
          >
            <Select
              name="batch"
              defaultValue={batch}
              className="w-56"
              aria-label="Filter by batch"
            >
              <option value="">All batches</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary">
              Apply
            </Button>
            {batch && (
              <Button asChild variant="ghost">
                <Link href="/admin/notes">Clear</Link>
              </Button>
            )}
          </form>

          {notes.length === 0 ? (
            <EmptyState
              title={batch ? "No material for this batch yet" : "No study material yet"}
              description="Upload a PDF — a chapter summary, a formula sheet, a previous paper — and the batch you choose will see it the next time they sign in."
              action={
                <NoteFormDialog
                  batches={batches}
                  subjects={subjects}
                  defaultBatchId={batch || undefined}
                />
              }
            />
          ) : (
            <Card>
              <Table>
                <thead>
                  <tr>
                    <Th>Title</Th>
                    <Th>Batch / class</Th>
                    <Th>Subject</Th>
                    <Th>Size</Th>
                    <Th>Uploaded</Th>
                    <Th>Visibility</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {notes.map((note) => (
                    <tr key={note.id} className={note.active ? "" : "opacity-60"}>
                      <Td>
                        <p className="font-medium">{note.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {note.originalName}
                        </p>
                        {note.description && (
                          <p className="mt-0.5 max-w-md text-xs text-muted-foreground">
                            {note.description}
                          </p>
                        )}
                      </Td>
                      <Td>{note.batch.name}</Td>
                      <Td>
                        {note.subject ? (
                          <Badge tone="primary">{note.subject.name}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">General</span>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatFileSize(note.fileSize)}
                      </Td>
                      <Td className="whitespace-nowrap text-muted-foreground">
                        {formatDate(note.uploadedAt)}
                      </Td>
                      <Td>
                        <Badge tone={note.active ? "success" : "neutral"}>
                          {note.active ? "Visible" : "Hidden"}
                        </Badge>
                        {/* Separate from visibility: this one is about whether a
                            class may keep a copy of what they can already read. */}
                        {!note.allowDownload && (
                          <Badge tone="warning" className="ml-1">
                            Read-only
                          </Badge>
                        )}
                      </Td>
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <Button asChild variant="ghost" size="sm">
                            <a
                              href={`/api/notes/${note.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Eye /> View
                            </a>
                          </Button>
                          <Button asChild variant="ghost" size="sm">
                            <a href={`/api/notes/${note.id}?download=1`}>
                              <Download />
                            </a>
                          </Button>

                          {note.active ? (
                            <ConfirmButton
                              variant="ghost"
                              size="sm"
                              title={`Hide “${note.title}”?`}
                              description="Students stop seeing it immediately. The file is kept, so you can show it again at any time."
                              confirmLabel="Hide"
                              confirmVariant="danger"
                              action={setNoteActive.bind(null, note.id, false)}
                            >
                              <Lock />
                            </ConfirmButton>
                          ) : (
                            <ConfirmButton
                              variant="ghost"
                              size="sm"
                              title={`Show “${note.title}” again?`}
                              description="The batch will see this material in their Study Notes again."
                              confirmLabel="Show"
                              confirmVariant="success"
                              action={setNoteActive.bind(null, note.id, true)}
                            >
                              <LockOpen />
                            </ConfirmButton>
                          )}

                          {/* Readable but not keepable, or both. The download
                              route enforces it; this only sets it. */}
                          <ConfirmButton
                            variant="ghost"
                            size="sm"
                            aria-label={
                              note.allowDownload
                                ? `Stop students downloading ${note.title}`
                                : `Let students download ${note.title}`
                            }
                            title={
                              note.allowDownload
                                ? `Stop students downloading “${note.title}”?`
                                : `Let students download “${note.title}”?`
                            }
                            description={
                              note.allowDownload
                                ? "They can still open it and read it on screen — they just cannot keep a copy."
                                : "They will be able to save their own copy of this material."
                            }
                            confirmLabel={note.allowDownload ? "Make read-only" : "Allow"}
                            confirmVariant={note.allowDownload ? "danger" : "success"}
                            action={setNoteDownloadable.bind(null, note.id, !note.allowDownload)}
                          >
                            <DownloadCloud
                              className={note.allowDownload ? "" : "opacity-40"}
                            />
                          </ConfirmButton>

                          <ConfirmButton
                            variant="ghost"
                            size="sm"
                            title={`Delete “${note.title}”?`}
                            description="The PDF is removed from the server as well. This cannot be undone — hide it instead if you only want to take it away from students for a while."
                            confirmLabel="Delete"
                            action={deleteNote.bind(null, note.id)}
                          >
                            <Trash2 />
                          </ConfirmButton>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </>
      )}
    </>
  );
}
