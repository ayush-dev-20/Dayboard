"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectDialog } from "./project-dialog";

/** "New project": a small dialog, then straight into the new project. */
export function NewProjectButton({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus strokeWidth={1.5} aria-hidden /> New project
      </Button>
      <ProjectDialog
        open={open}
        onOpenChange={setOpen}
        onSaved={(project) => router.push(`/projects/${project.id}`)}
      />
    </>
  );
}
