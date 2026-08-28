import { permanentRedirect } from "next/navigation";

/**
 * Results moved into the Reports section, which is where marks are read. Old
 * links and bookmarks under /admin/exams keep working.
 */
export default async function LegacyResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  permanentRedirect(`/admin/reports/${id}`);
}
