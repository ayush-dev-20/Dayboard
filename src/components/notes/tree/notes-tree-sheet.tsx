"use client";

import { useState } from "react";
import { ListTree } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { cn } from "@/lib/utils";
import { NotesTree } from "./notes-tree";
import { useOpenBranches } from "./use-open-branches";

/**
 * The notes tree for a phone (V2 feature 07 §5): there is no sidebar there, so a button opens it in
 * a sheet from the left. Choosing a note closes the sheet. Not shown from tablet width up.
 */
export function NotesTreeSheet({ className }: { className?: string }) {
  const { noteTree } = useWorkspace();
  const branches = useOpenBranches();
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Browse notes"
        className={cn(
          "inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden",
          className,
        )}
      >
        <ListTree className="size-4" strokeWidth={1.5} aria-hidden />
      </SheetTrigger>
      <SheetContent side="left" aria-describedby={undefined}>
        <SheetTitle className="sr-only">Notes</SheetTitle>
        <SheetDescription className="sr-only">Every note, where it sits</SheetDescription>
        <div className="h-full overflow-y-auto px-3 py-4">
          <p className="mb-2 px-2 type-label-caps text-muted-foreground">Notes</p>
          <NotesTree initial={noteTree} branches={branches} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
