"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addStarterTemplates } from "@/actions/templates";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { starterList, type StarterKey } from "@/lib/templates/starters";

/**
 * "Add starter templates": the four starters with a checkbox each. One already in the list is labelled and cannot be
 * ticked, so adding twice never makes a duplicate and never touches a copy that was edited.
 */
export function StarterDialog({
  have,
  variant = "secondary",
}: {
  /** The starters the person already has (live). */
  have: StarterKey[];
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<StarterKey[]>([]);
  const [busy, setBusy] = useState(false);

  const toggle = (key: StarterKey) =>
    setPicked((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );

  async function add() {
    setBusy(true);
    const result = await addStarterTemplates({ keys: picked });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setOpen(false);
    setPicked([]);
    toast(
      `Added ${result.data.added.length} ${result.data.added.length === 1 ? "template" : "templates"}.`,
    );
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPicked([]);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant}>Add starter templates</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Add starter templates</DialogTitle>
        <DialogDescription>
          Ready-made layouts. Each one is added as your own copy, so you can change it freely.
        </DialogDescription>
        <fieldset className="mt-4 flex flex-col gap-1">
          <legend className="sr-only">Starter templates</legend>
          {starterList().map((starter) => {
            const owned = have.includes(starter.key);
            return (
              <label
                key={starter.key}
                className="flex min-h-11 items-start gap-3 rounded-md px-2 py-2 hover:bg-accent has-[:disabled]:opacity-60 md:min-h-9"
              >
                <input
                  type="checkbox"
                  disabled={owned}
                  checked={owned || picked.includes(starter.key)}
                  onChange={() => toggle(starter.key)}
                  className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                />
                <span className="min-w-0">
                  <span className="type-body-md">
                    <span aria-hidden>{starter.emoji} </span>
                    {starter.name}
                    {owned ? (
                      <span className="ml-2 type-label-caps text-muted-foreground">
                        Already added
                      </span>
                    ) : null}
                  </span>
                  <span className="block type-body-sm text-muted-foreground">
                    {starter.description}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <DialogFooter className="mt-4">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={() => void add()} disabled={busy || picked.length === 0}>
            Add {picked.length > 0 ? picked.length : ""} selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
