"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectDialog } from "./project-dialog";

/** "New project": a small dialog, then straight into the new project. */
export function NewProjectButton({
  variant = "primary",
  autoOpen = false,
}: {
  variant?: "primary" | "secondary";
  /** Open the dialog on arrival (the command menu's "New project"). */
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus strokeWidth={1.5} aria-hidden /> New project
      </Button>
      <ProjectDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next && autoOpen) router.replace("/projects");
        }}
        onSaved={(project) => router.push(`/projects/${project.id}`)}
      />
    </>
  );
}
