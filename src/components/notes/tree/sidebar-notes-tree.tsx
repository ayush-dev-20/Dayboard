"use client";

import { ChevronRight } from "lucide-react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { cn } from "@/lib/utils";
import { NotesTree } from "./notes-tree";
import { useOpenBranches } from "./use-open-branches";

// The tree under Notes in the sidebar (V2 feature 07 §5). A chevron on the Notes row shows and
// hides it; the choice and the open branches are remembered on this device.

/** The chevron at the end of the Notes row. */
export function NotesTreeToggle({ className }: { className?: string }) {
  const { shown, setShown } = useOpenBranches();
  return (
    <button
      type="button"
      onClick={() => setShown(!shown)}
      aria-expanded={shown}
      aria-label={shown ? "Hide notes tree" : "Show notes tree"}
      className={cn(
        "inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground lg:size-6",
        className,
      )}
    >
      <ChevronRight
        className={cn(
          "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
          shown && "rotate-90",
        )}
        strokeWidth={1.5}
        aria-hidden
      />
    </button>
  );
}

export function SidebarNotesTree({ onNavigate }: { onNavigate?: () => void }) {
  const { noteTree } = useWorkspace();
  const branches = useOpenBranches();
  if (!branches.shown) return null;
  return (
    <div className="mt-0.5">
      <NotesTree initial={noteTree} branches={branches} onNavigate={onNavigate} />
    </div>
  );
}
