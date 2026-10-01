"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FOCUS_ADD_EVENT } from "@/lib/shortcuts";

/** "New task" / "New todo": the inline add row is the one place things are created, so this focuses it. */
export function NewItemButton({ label }: { label: string }) {
  return (
    <Button
      onClick={() => window.dispatchEvent(new Event(FOCUS_ADD_EVENT))}
      className="max-md:hidden"
    >
      <Plus strokeWidth={1.5} aria-hidden /> {label}
    </Button>
  );
}
