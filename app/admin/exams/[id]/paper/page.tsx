import { permanentRedirect } from "next/navigation";

/**
 * Question papers moved into their own section. Old links and bookmarks that
 * still point under /admin/exams keep working.
 */
export default async function LegacyPaperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  permanentRedirect(`/admin/papers/${id}`);
}
