"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Kanban, Plus, Shapes } from "lucide-react";
import { toast } from "sonner";
import { createCanvas } from "@/actions/canvases";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BOARD_PRESETS, PRESET_LABELS, type BoardPreset } from "@/lib/canvas/board";
import { cn } from "@/lib/utils";

const PRESET_HINTS: Record<BoardPreset, string> = {
  status: "Planned, In progress, Waiting, Completed, Cancelled",
  simple: "To do, Doing, Done",
  blank: "One column, Ideas",
};

/**
 * "New canvas": a small menu. New drawing makes an empty drawing; New sticky board makes a board of sticky notes from a
 * preset (Status board, Simple or Blank). Nothing exists until the click, so a failure leaves nothing behind and says why
 * (the limit of 100 canvases is the one a person can reach).
 */
export function NewCanvasButton({
  variant = "primary",
  className,
}: {
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create(input: { kind?: "BOARD"; preset?: BoardPreset }) {
    setBusy(true);
    const result = await createCanvas(input);
    if (!result.ok) {
      setBusy(false);
      toast.error(result.error.message);
      return;
    }
    router.push(`/canvases/${result.data.id}`);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} disabled={busy} className={cn(className)}>
          <Plus strokeWidth={1.5} aria-hidden /> New canvas
          <ChevronDown className="-mr-1" strokeWidth={1.5} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuItem onSelect={() => void create({})}>
          <Shapes strokeWidth={1.5} aria-hidden /> New drawing
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2 type-label-caps text-muted-foreground">
          <Kanban className="size-4" strokeWidth={1.5} aria-hidden /> New sticky board
        </DropdownMenuLabel>
        {BOARD_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset}
            className="flex-col items-start gap-0"
            onSelect={() => void create({ kind: "BOARD", preset })}
          >
            <span>{PRESET_LABELS[preset]}</span>
            <span className="type-body-sm text-muted-foreground">{PRESET_HINTS[preset]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
