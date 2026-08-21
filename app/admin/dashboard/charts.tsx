/* Dashboard charts.
 *
 * Plain HTML bars rather than a charting library: both figures are single-axis
 * magnitude comparisons, they render inside a server component with no client
 * JavaScript, and they inherit the theme tokens so dark mode needs no work.
 * Every bar carries its number as text, so the colour is decoration and the
 * chart stays readable in greyscale, in print and for a screen reader. */

import { EmptyState } from "@/components/ui/primitives";

/** A batch and how many active students sit in it. */
export type BatchDatum = { id: string; name: string; count: number };

/** Attempts on one exam, split by how they ended. */
export type ExamAttemptDatum = {
  id: string;
  name: string;
  submitted: number;
  inProgress: number;
  expired: number;
};

const OUTCOMES = [
  { key: "submitted", label: "Submitted", color: "bg-chart-submitted" },
  { key: "inProgress", label: "In progress", color: "bg-chart-progress" },
  { key: "expired", label: "Expired", color: "bg-chart-expired" },
] as const;

/** Horizontal bars, one hue: the comparison is size, not identity. */
export function StudentsPerBatchChart({ data }: { data: BatchDatum[] }) {
  if (data.length === 0) {
    return (
      <EmptyState
        title="No active batches"
        description="Create a batch and add students to see the split here."
      />
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);
  const total = data.reduce((sum, d) => sum + d.count, 0);

  return (
    <div>
      <ul className="space-y-3">
        {data.map((batch) => (
          <li key={batch.id} className="grid grid-cols-[minmax(5rem,10rem)_1fr_2.5rem] items-center gap-3">
            <span className="truncate text-sm" title={batch.name}>
              {batch.name}
            </span>
            <span
              className="h-2 rounded-[4px] bg-chart-track"
              title={`${batch.name}: ${batch.count} active student${batch.count === 1 ? "" : "s"}`}
            >
              <span
                className="block h-full rounded-r-[4px] bg-chart-1"
                style={{ width: `${(batch.count / max) * 100}%` }}
              />
            </span>
            <span className="text-right text-sm tabular-nums text-muted-foreground">
              {batch.count}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">
        {total} active student{total === 1 ? "" : "s"} across {data.length} batch
        {data.length === 1 ? "" : "es"}.
      </p>
    </div>
  );
}

/** Stacked bars: one per exam, split by attempt outcome. */
export function AttemptOutcomesChart({ data }: { data: ExamAttemptDatum[] }) {
  if (data.length === 0) {
    return (
      <EmptyState
        title="No published exams yet"
        description="Once students start attempting an exam, their progress shows up here."
      />
    );
  }

  const max = Math.max(
    ...data.map((d) => d.submitted + d.inProgress + d.expired),
    1,
  );

  return (
    <div>
      {/* Legend first: for three series the colour alone must never be the key. */}
      <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1">
        {OUTCOMES.map((outcome) => (
          <li
            key={outcome.key}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span className={`size-2 rounded-[2px] ${outcome.color}`} />
            {outcome.label}
          </li>
        ))}
      </ul>

      <ul className="space-y-3">
        {data.map((exam) => {
          const total = exam.submitted + exam.inProgress + exam.expired;
          return (
            <li key={exam.id}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="truncate text-sm" title={exam.name}>
                  {exam.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {total === 0
                    ? "No attempts yet"
                    : `${total} attempt${total === 1 ? "" : "s"}`}
                </span>
              </div>
              {/* The track is scaled to the busiest exam so bar lengths stay
                  comparable between rows; segments are gapped by 2px. */}
              <div className="h-2 rounded-[4px] bg-chart-track">
                <div
                  className="flex h-full gap-[2px]"
                  style={{ width: `${(total / max) * 100}%` }}
                >
                  {OUTCOMES.map((outcome) => {
                    const value = exam[outcome.key];
                    if (value === 0) return null;
                    return (
                      <span
                        key={outcome.key}
                        className={`h-full rounded-[3px] ${outcome.color}`}
                        style={{ width: `${(value / total) * 100}%` }}
                        title={`${exam.name} — ${outcome.label}: ${value}`}
                      />
                    );
                  })}
                </div>
              </div>
              {total > 0 && (
                <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                  {OUTCOMES.filter((o) => exam[o.key] > 0)
                    .map((o) => `${exam[o.key]} ${o.label.toLowerCase()}`)
                    .join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
