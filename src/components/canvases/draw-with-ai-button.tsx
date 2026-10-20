"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { DrawWithAiDialog } from "./draw-with-ai-dialog";

/** "Draw with AI" on the list: a plain button with a verb (no sparkle). Not shown when AI is off. */
export function DrawWithAiButton({ className }: { className?: string }) {
  const { aiEnabled } = useWorkspace();
  const [open, setOpen] = useState(false);
  if (!aiEnabled) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} className={className}>
        Draw with AI
      </Button>
      <DrawWithAiDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
