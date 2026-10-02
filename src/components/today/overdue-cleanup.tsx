"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { archiveTask, setTaskStatus, updateTask } from "@/actions/tasks";
import { AiFailureNotice, AiGenerating, AiLabel, DueDateChip } from "@/components/ai/ai-ui";
import { useAICall } from "@/components/ai/use-ai";
import { Button } from "@/components/ui/button";
import { CheckButton } from "@/components/ui/check-button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { formatPickerDay } from "@/lib/dates/calendar";
import type { OverdueProposal } from "@/lib/ai/overdue";
import { OVERDUE_ACTIONS, type OverdueAction } from "@/lib/ai/schemas";

const ACTION_LABEL: Record<OverdueAction, string> = {
  KEEP: "Keep",
  RESCHEDULE: "Reschedule",
  ARCHIVE: "Archive",
  CANCEL: "Cancel task",
};

/** "Help me clean up" beside the Overdue heading. Proposes; each applied row is the person's click. */
export function OverdueCleanup() {
  const { aiEnabled } = useWorkspace();
  const call = useAICall<{ proposals: OverdueProposal[] }>("/api/ai/overdue-cleanup");
  const [open, setOpen] = useState(false);
  if (!aiEnabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          call.run({});
          setOpen(true);
        }}
        className="inline-flex h-8 items-center type-body-md text-primary underline underline-offset-2"
      >
        Help me clean up
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) call.reset();
        }}
      >
        <DialogContent className="sm:max-w-[620px]">
          <DialogTitle>Clean up overdue tasks</DialogTitle>
          {call.state.status === "complete" && call.state.data.proposals.length > 0 ? (
            <ProposalList
              proposals={call.state.data.proposals}
              onDone={() => {
                setOpen(false);
                call.reset();
              }}
            />
          ) : (
            <>
              <DialogDescription>
                {call.state.status === "complete"
                  ? "Nothing here needs cleaning up."
                  : "Looking at your overdue tasks…"}
              </DialogDescription>
              {call.state.status === "failed" ? (
                <AiFailureNotice
                  className="mt-4"
                  error={call.state.error}
                  text="Couldn’t suggest a cleanup. Nothing was changed."
                  onRetry={call.retry}
                  onDismiss={() => setOpen(false)}
                />
              ) : call.state.status === "generating" ? (
                <div className="mt-4">
                  <AiGenerating />
                </div>
              ) : null}
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary">
                    {call.state.status === "complete" ? "Close" : "Cancel"}
                  </Button>
                </DialogClose>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

type Row = {
  proposal: OverdueProposal;
  action: OverdueAction;
  newDueDate: string | null;
  checked: boolean;
};

function ProposalList({ proposals, onDone }: { proposals: OverdueProposal[]; onDone: () => void }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    proposals.map((proposal) => ({
      proposal,
      action: proposal.action,
      newDueDate: proposal.newDueDate,
      // Destructive proposals start unticked: the person opts in.
      checked: proposal.action === "KEEP" || proposal.action === "RESCHEDULE",
    })),
  );
  const [pending, setPending] = useState(false);
  const chosen = rows.filter((r) => r.checked);
  const missingDate = chosen.some((r) => r.action === "RESCHEDULE" && !r.newDueDate);

  function update(index: number, patch: Partial<Row>) {
    setRows((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function apply() {
    setPending(true);
    let changed = 0;
    let failed = 0;
    for (const row of chosen) {
      const id = row.proposal.taskId;
      if (row.action === "KEEP") continue;
      const result =
        row.action === "RESCHEDULE"
          ? await updateTask({ id, dueDate: row.newDueDate })
          : row.action === "ARCHIVE"
            ? await archiveTask({ id })
            : await setTaskStatus({ id, status: "CANCELLED" });
      if (result.ok) changed += 1;
      else failed += 1;
    }
    setPending(false);
    router.refresh();
    if (failed > 0) {
      toast.error(`${failed} ${failed === 1 ? "task" : "tasks"} couldn’t be changed.`);
    } else {
      toast(
        changed === 0
          ? "Nothing changed."
          : `Updated ${changed} ${changed === 1 ? "task" : "tasks"}.`,
      );
    }
    onDone();
  }

  return (
    <>
      <DialogDescription>
        Change any action before you apply. Nothing changes until you do.
      </DialogDescription>
      <div className="mt-4">
        <AiLabel />
      </div>
      <ul className="mt-2 max-h-[50vh] overflow-y-auto" aria-label="Proposed changes">
        {rows.map((row, i) => (
          <li
            key={row.proposal.taskId}
            className="flex flex-wrap items-center gap-x-1 border-b border-border py-2 last:border-b-0 sm:flex-nowrap"
          >
            <CheckButton
              checked={row.checked}
              onCheckedChange={(checked) => update(i, { checked })}
              label={`Apply to ${row.proposal.title}`}
            />
            <div className="min-w-0 flex-1">
              <p className="type-body-md">{row.proposal.title}</p>
              <p className="type-body-sm text-muted-foreground">
                Due {formatPickerDay(row.proposal.dueDate).replace(/^\w+, /, "")}.{" "}
                {row.proposal.reason}
              </p>
            </div>
            <div className="ml-12 flex items-center sm:ml-0">
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Action for ${row.proposal.title}: ${ACTION_LABEL[row.action]}`}
                  className="inline-flex h-11 items-center gap-1 rounded-md px-2 type-body-md font-semibold hover:bg-accent md:h-8"
                >
                  {ACTION_LABEL[row.action]}
                  <ChevronDown
                    className="size-4 text-muted-foreground"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup
                    value={row.action}
                    onValueChange={(v) => update(i, { action: v as OverdueAction })}
                  >
                    {OVERDUE_ACTIONS.map((action) => (
                      <DropdownMenuRadioItem key={action} value={action}>
                        {ACTION_LABEL[action]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              {row.action === "RESCHEDULE" ? (
                <DueDateChip
                  value={row.newDueDate}
                  onChange={(date) => update(i, { newDueDate: date })}
                  label={`New due date for ${row.proposal.title}`}
                />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button
          disabled={pending || chosen.length === 0 || missingDate}
          onClick={() => void apply()}
        >
          {chosen.length === 0 ? "Apply" : `Apply ${chosen.length}`}
        </Button>
      </DialogFooter>
    </>
  );
}
