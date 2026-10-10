"use client";

import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { applyAssistantProposal } from "@/actions/assistant";
import { AiFailureNotice, AiLabel, DueDateChip } from "@/components/ai/ai-ui";
import { Button } from "@/components/ui/button";
import { CheckButton } from "@/components/ui/check-button";
import { Input } from "@/components/ui/input";
import type { CreateRow, LinkRow, Proposal, TaskFields, UpdateRow } from "@/lib/ai/assistant-types";
import { formatPickerDay } from "@/lib/dates/calendar";
import { cn } from "@/lib/utils";
import { patchThread, type StoredProposal } from "./threads";

// A proposal in the thread (V2 feature 11 §5): a checklist the person edits and confirms. The
// assistant cannot change anything; only the Confirm click does, through a Server Action that checks
// every row again. Cancelling or ignoring it changes nothing.

const PRIORITY_LABEL = { NONE: "No priority", LOW: "Low", MEDIUM: "Medium", HIGH: "High" } as const;
const STATUS_LABEL = {
  INBOX: "Inbox",
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  WAITING: "Waiting",
  DONE: "Done",
  CANCELLED: "Cancelled",
} as const;
const day = (value: string | null) => (value ? formatPickerDay(value) : "No date");

type Props = {
  threadId: string;
  messageId: string;
  index: number;
  stored: StoredProposal;
};

export function ProposalCard({ threadId, messageId, index, stored }: Props) {
  const { proposal } = stored;
  const setStatus = (patch: Partial<StoredProposal>) =>
    patchThread(threadId, (t) => ({
      ...t,
      messages: t.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              proposals: m.proposals?.map((p, i) => (i === index ? { ...p, ...patch } : p)),
            }
          : m,
      ),
    }));

  if (stored.status === "dismissed") {
    return (
      <p className="type-body-sm text-muted-foreground" data-testid="proposal-dismissed">
        Suggestion dismissed. Nothing was changed.
      </p>
    );
  }
  if (stored.status === "applied") {
    return (
      <p
        role="status"
        className="flex items-center gap-2 type-body-md"
        data-testid="proposal-applied"
      >
        <Check className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        {resultText(proposal, stored.applied ?? 0, stored.failed ?? 0)}
      </p>
    );
  }
  return (
    <PendingCard
      proposal={proposal}
      onApplied={(applied, failed) => setStatus({ status: "applied", applied, failed })}
      onDismiss={() => setStatus({ status: "dismissed" })}
    />
  );
}

function resultText(proposal: Proposal, applied: number, failed: number): string {
  const noun =
    proposal.kind === "linkNotes"
      ? applied === 1
        ? "link"
        : "links"
      : applied === 1
        ? "task"
        : "tasks";
  const verb =
    proposal.kind === "createTasks"
      ? "Created"
      : proposal.kind === "updateTasks"
        ? "Updated"
        : "Linked";
  const base = `${verb} ${applied} ${noun}.`;
  return failed > 0 ? `${base} ${failed} could not be applied.` : base;
}

type Draft<T> = T & { checked: boolean };

function PendingCard({
  proposal,
  onApplied,
  onDismiss,
}: {
  proposal: Proposal;
  onApplied: (applied: number, failed: number) => void;
  onDismiss: () => void;
}) {
  const [create, setCreate] = useState<Draft<CreateRow>[]>(() =>
    proposal.kind === "createTasks" ? proposal.items.map((r) => ({ ...r, checked: true })) : [],
  );
  const [updates, setUpdates] = useState<Draft<UpdateRow>[]>(() =>
    proposal.kind === "updateTasks" ? proposal.changes.map((r) => ({ ...r, checked: true })) : [],
  );
  const [links, setLinks] = useState<Draft<LinkRow>[]>(() =>
    proposal.kind === "linkNotes" ? proposal.links.map((r) => ({ ...r, checked: true })) : [],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows =
    proposal.kind === "createTasks" ? create : proposal.kind === "updateTasks" ? updates : links;
  const chosen = rows.filter((r) => r.checked).length;
  const blank = create.some((r) => r.checked && r.title.trim() === "");

  async function confirm(event?: React.FormEvent) {
    event?.preventDefault();
    if (pending || chosen === 0 || blank) return;
    setPending(true);
    setError(null);
    const base = { proposalId: proposal.id };
    const body =
      proposal.kind === "createTasks"
        ? {
            ...base,
            kind: "createTasks" as const,
            items: create
              .filter((r) => r.checked)
              .map((r) => ({
                title: r.title.trim(),
                dueDate: r.dueDate,
                priority: r.priority,
                projectId: r.projectId,
                linkNoteId: r.linkNoteId,
              })),
          }
        : proposal.kind === "updateTasks"
          ? {
              ...base,
              kind: "updateTasks" as const,
              changes: updates
                .filter((r) => r.checked)
                .map((r) => ({ taskId: r.taskId, set: r.set })),
            }
          : {
              ...base,
              kind: "linkNotes" as const,
              links: links
                .filter((r) => r.checked)
                .map((r) => ({ taskId: r.taskId, noteId: r.noteId })),
            };
    const result = await applyAssistantProposal(body);
    if (result.ok) {
      onApplied(result.data.applied, result.data.failed);
    } else {
      setError(
        result.error.code === "CONFLICT"
          ? "That suggestion was already applied."
          : result.error.message,
      );
      setPending(false);
    }
  }

  const confirmLabel =
    chosen === 0
      ? "Nothing selected"
      : proposal.kind === "createTasks"
        ? `Create ${chosen} ${chosen === 1 ? "task" : "tasks"}`
        : proposal.kind === "updateTasks"
          ? `Update ${chosen} ${chosen === 1 ? "task" : "tasks"}`
          : `Link ${chosen} ${chosen === 1 ? "note" : "notes"}`;
  const heading =
    proposal.kind === "createTasks"
      ? `Suggested ${proposal.items.length} ${proposal.items.length === 1 ? "task" : "tasks"}`
      : proposal.kind === "updateTasks"
        ? `Suggested changes to ${proposal.changes.length} ${proposal.changes.length === 1 ? "task" : "tasks"}`
        : `Suggested ${proposal.links.length} ${proposal.links.length === 1 ? "link" : "links"}`;
  const allChecked = chosen === rows.length;
  const setAll = (checked: boolean) => {
    setCreate((l) => l.map((r) => ({ ...r, checked })));
    setUpdates((l) => l.map((r) => ({ ...r, checked })));
    setLinks((l) => l.map((r) => ({ ...r, checked })));
  };

  return (
    <form
      onSubmit={(e) => void confirm(e)}
      noValidate
      aria-label={heading}
      className="ai-panel px-3 pt-3 pb-3"
      data-testid="proposal-card"
    >
      <div className="flex items-center justify-between gap-3">
        <AiLabel>AI suggestion</AiLabel>
        <p className="flex items-center gap-3 type-body-sm text-muted-foreground">
          <span aria-live="polite">
            {chosen} of {rows.length} selected
          </span>
          <Button variant="secondary" onClick={() => setAll(!allChecked)}>
            {allChecked ? "Select none" : "Select all"}
          </Button>
        </p>
      </div>
      <p className="mt-1 type-label-md">{heading}</p>

      <ul className="mt-1" aria-label={heading}>
        {proposal.kind === "createTasks" &&
          create.map((row, i) => (
            <Row
              key={i}
              checked={row.checked}
              onChecked={(c) =>
                setCreate((l) => l.map((r, j) => (j === i ? { ...r, checked: c } : r)))
              }
              label={`Include ${row.title || "this task"}`}
            >
              <div className="min-w-0 flex-1">
                <Input
                  aria-label={`Task title ${i + 1}`}
                  value={row.title}
                  maxLength={500}
                  disabled={!row.checked}
                  onChange={(e) =>
                    setCreate((l) =>
                      l.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)),
                    )
                  }
                  aria-invalid={row.checked && row.title.trim() === "" ? true : undefined}
                />
                <p className="mt-1 px-3 type-body-sm text-muted-foreground">
                  {[
                    row.priority !== "NONE" ? `${PRIORITY_LABEL[row.priority]} priority` : null,
                    row.projectName ? `In ${row.projectName}` : null,
                    row.linkNoteTitle ? `Linked to “${row.linkNoteTitle}”` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || null}
                </p>
              </div>
              <DueDateChip
                value={row.dueDate}
                onChange={(dueDate) =>
                  setCreate((l) => l.map((r, j) => (j === i ? { ...r, dueDate } : r)))
                }
                label={`Due date for ${row.title || "this task"}`}
              />
            </Row>
          ))}

        {proposal.kind === "updateTasks" &&
          updates.map((row, i) => (
            <Row
              key={row.taskId}
              checked={row.checked}
              onChecked={(c) =>
                setUpdates((l) => l.map((r, j) => (j === i ? { ...r, checked: c } : r)))
              }
              label={`Include the change to ${row.title}`}
            >
              <div className="min-w-0 flex-1 py-2">
                <p className="truncate type-body-md font-semibold">{row.title}</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {changeLines(row).map((line) => (
                    <li
                      key={line.label}
                      className="flex flex-wrap items-center gap-1.5 type-body-sm"
                    >
                      <span className="text-muted-foreground">{line.label}</span>
                      <span>{line.before}</span>
                      <ArrowRight
                        className="size-3.5 text-muted-foreground"
                        strokeWidth={1.5}
                        aria-label="to"
                      />
                      <b className="font-semibold">{line.after}</b>
                    </li>
                  ))}
                </ul>
              </div>
            </Row>
          ))}

        {proposal.kind === "linkNotes" &&
          links.map((row, i) => (
            <Row
              key={`${row.taskId}-${row.noteId}`}
              checked={row.checked}
              onChecked={(c) =>
                setLinks((l) => l.map((r, j) => (j === i ? { ...r, checked: c } : r)))
              }
              label={`Link ${row.noteTitle} to ${row.taskTitle}`}
            >
              <p className="min-w-0 flex-1 py-2 type-body-md">
                <span className="font-semibold">{row.taskTitle}</span>
                <span className="text-muted-foreground"> ← note </span>
                <span className="font-semibold">“{row.noteTitle}”</span>
              </p>
            </Row>
          ))}
      </ul>

      {error ? (
        <AiFailureNotice
          className="mt-2"
          error={{ code: "VALIDATION_ERROR", message: error }}
          text={error}
        />
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={onDismiss} disabled={pending}>
          Dismiss
        </Button>
        <Button type="submit" disabled={pending || chosen === 0 || blank}>
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
}

function Row({
  checked,
  onChecked,
  label,
  children,
}: {
  checked: boolean;
  onChecked: (checked: boolean) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li
      className={cn(
        "flex items-start gap-x-1 border-b border-ai-border py-1 transition-opacity duration-150 last:border-b-0",
        !checked && "opacity-60",
      )}
    >
      <CheckButton checked={checked} onCheckedChange={onChecked} label={label} />
      {children}
    </li>
  );
}

/** Before → after for each thing a change touches. Built from what the database says now. */
function changeLines(row: UpdateRow): { label: string; before: string; after: string }[] {
  const lines: { label: string; before: string; after: string }[] = [];
  const set: TaskFields = row.set;
  if (set.dueDate !== undefined)
    lines.push({ label: "Due", before: day(row.before.dueDate), after: day(set.dueDate) });
  if (set.priority !== undefined) {
    lines.push({
      label: "Priority",
      before: PRIORITY_LABEL[row.before.priority],
      after: PRIORITY_LABEL[set.priority],
    });
  }
  if (set.status !== undefined) {
    lines.push({
      label: "Status",
      before: STATUS_LABEL[row.before.status],
      after: STATUS_LABEL[set.status],
    });
  }
  if (set.projectId !== undefined) {
    lines.push({
      label: "Project",
      before: row.before.projectName ?? "None",
      after: set.projectId === null ? "None" : (row.projectName ?? "A project"),
    });
  }
  return lines;
}
