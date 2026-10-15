"use client";

import Link from "next/link";
import { ListChecks } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { applyCarry, undoCarry } from "@/actions/review";
import { AiLabel, AiPanel, DueDateChip } from "@/components/ai/ai-ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckButton } from "@/components/ui/check-button";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDay } from "@/lib/dates/calendar";
import { countOf } from "@/lib/review/format";
import type { CarryUndo, ReviewDTO } from "@/lib/review/types";
import { cn } from "@/lib/utils";

// The carry-forward proposal (V2 feature 15 §5, §6): an editable list, nothing changes until Apply. KEEP and
// RESCHEDULE start ticked, a suggested DROP starts unticked (and, when ticked, is an Archive unless the person picks
// Cancel). Apply goes through the person's own task commands, and the toast offers Undo.

type Action = "KEEP" | "RESCHEDULE" | "ARCHIVE" | "CANCEL";
type Row = {
  taskId: string;
  title: string;
  reason: string;
  checked: boolean;
  action: Action;
  dueDate: string | null;
};

const LABEL: Record<Action, string> = {
  KEEP: "Keep as it is",
  RESCHEDULE: "Reschedule",
  ARCHIVE: "Archive",
  CANCEL: "Cancel task",
};

export function CarryForward({ review, today }: { review: ReviewDTO; today: string }) {
  const router = useRouter();
  const facts = review.facts;
  const [rows, setRows] = useState<Row[]>(() =>
    (review.suggestions?.carryForward ?? []).map((c) => ({
      taskId: c.taskId,
      title: c.title,
      reason: c.reason,
      checked: c.action !== "DROP",
      action: c.action === "DROP" ? "ARCHIVE" : c.action,
      dueDate: c.action === "RESCHEDULE" ? c.newDueDate : null,
    })),
  );
  const [pending, setPending] = useState(false);
  const [applied, setApplied] = useState<{ count: number; undo: CarryUndo[] } | null>(
    review.carryApplied ? { count: -1, undo: [] } : null,
  );
  const [error, setError] = useState<string | null>(null);
  if (rows.length === 0) return null;

  const dueOf = (taskId: string) => facts?.overdue.items.find((t) => t.id === taskId);
  const changes = rows.filter((r) => r.checked && r.action !== "KEEP");
  const missingDate = changes.some(
    (r) => r.action === "RESCHEDULE" && (!r.dueDate || r.dueDate < today),
  );
  const update = (taskId: string, patch: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.taskId === taskId ? { ...r, ...patch } : r)));

  async function apply() {
    if (pending || changes.length === 0 || missingDate) return;
    setPending(true);
    setError(null);
    let result;
    try {
      result = await applyCarry({
        reviewId: review.id,
        rows: rows
          .filter((r) => r.checked)
          .map((r) => ({
            taskId: r.taskId,
            action: r.action,
            ...(r.action === "RESCHEDULE" ? { dueDate: r.dueDate } : {}),
          })),
      });
    } catch {
      result = null;
    }
    setPending(false);
    if (!result || !result.ok) {
      setError(
        result && !result.ok
          ? result.error.message
          : "Couldn't apply those. Check your connection. Nothing was changed.",
      );
      return;
    }
    const { applied: count, undo } = result.data;
    setApplied({ count, undo });
    toast(`Applied ${countOf(count, "change", "changes")}.`, {
      duration: 10_000,
      action: {
        label: "Undo",
        onClick: () => void revert(undo),
      },
    });
    router.refresh();
  }

  async function revert(undo: CarryUndo[]) {
    const result = await undoCarry({ reviewId: review.id, undo });
    if (!result.ok) {
      toast.error("Couldn't undo that.");
      return;
    }
    setApplied(null);
    toast("Undone.");
    router.refresh();
  }

  return (
    <AiPanel aria-labelledby="carry-forward-title">
      <AiLabel />
      <h2 id="carry-forward-title" className="mt-1 type-headline-sm text-foreground">
        Carry-forward
      </h2>
      <p className="mt-1 type-body-md text-muted-foreground">
        Suggestions for what to do with the tasks that are still open. Nothing changes until you
        apply.
      </p>

      {error ? <Alert className="mt-3">{error}</Alert> : null}

      <ul className="mt-3 divide-y divide-ai-border" aria-label="Carry-forward suggestions">
        {rows.map((row) => {
          const due = dueOf(row.taskId);
          return (
            <li
              key={row.taskId}
              className={cn(
                "flex flex-wrap items-start gap-x-1 gap-y-1 py-3 transition-opacity duration-150",
                !row.checked && "opacity-70",
                applied && "pointer-events-none opacity-60",
              )}
            >
              <CheckButton
                checked={row.checked}
                disabled={applied !== null}
                onCheckedChange={(checked) => update(row.taskId, { checked })}
                label={`Include ${row.title}`}
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/tasks/${row.taskId}`}
                  className="type-label-md text-foreground hover:underline"
                >
                  {row.title}
                </Link>
                {due ? (
                  <span className="ml-2 type-body-sm text-muted-foreground">
                    due {formatDay(due.dueDate, today)}
                    {due.daysLate > 0 ? ` · ${countOf(due.daysLate, "day", "days")} late` : ""}
                  </span>
                ) : null}
                <p className="mt-0.5 type-body-md text-foreground">{row.reason}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <NativeSelect
                    aria-label={`What to do with ${row.title}`}
                    value={row.action}
                    disabled={!row.checked || applied !== null}
                    wrapperClassName="inline-block"
                    className="w-auto"
                    onChange={(e) => {
                      const action = e.target.value as Action;
                      update(row.taskId, {
                        action,
                        dueDate: action === "RESCHEDULE" ? (row.dueDate ?? null) : row.dueDate,
                      });
                    }}
                  >
                    {(Object.keys(LABEL) as Action[]).map((a) => (
                      <option key={a} value={a}>
                        {LABEL[a]}
                      </option>
                    ))}
                  </NativeSelect>
                  {row.action === "RESCHEDULE" ? (
                    <DueDateChip
                      value={row.dueDate}
                      onChange={(dueDate) => update(row.taskId, { dueDate })}
                      label={`New date for ${row.title}`}
                    />
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
        {applied ? (
          <>
            <p role="status" className="type-body-md text-foreground">
              {applied.count >= 0
                ? `Applied ${countOf(applied.count, "change", "changes")}.`
                : "Applied."}
            </p>
            {applied.undo.length > 0 ? (
              <Button variant="secondary" onClick={() => void revert(applied.undo)}>
                Undo
              </Button>
            ) : null}
          </>
        ) : (
          <Button
            disabled={pending || changes.length === 0 || missingDate}
            onClick={() => void apply()}
          >
            <ListChecks strokeWidth={1.5} aria-hidden />
            {changes.length === 0 ? "Apply" : `Apply ${changes.length}`}
          </Button>
        )}
      </div>
    </AiPanel>
  );
}
