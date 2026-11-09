"use client";

import Link from "next/link";
import { ChevronDown, LayoutTemplate, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { openTemplatePicker } from "./template-picker";

/**
 * The Notes page's add control (V3 feature 03 §6): **New note**, and beside it a small menu with **From template…**. One
 * button group, so the primary action stays one click.
 */
export function NewNoteMenu() {
  return (
    <div className="inline-flex">
      <Link href="/notes/new" className={cn(buttonVariants(), "rounded-r-none")}>
        <Plus strokeWidth={1.5} aria-hidden /> New note
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="More ways to start a note"
          className={cn(
            buttonVariants(),
            "-ml-px cursor-pointer rounded-l-none border-l border-primary-foreground/30 px-2",
          )}
        >
          <ChevronDown strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openTemplatePicker()}>
            <LayoutTemplate strokeWidth={1.5} aria-hidden /> From template…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
