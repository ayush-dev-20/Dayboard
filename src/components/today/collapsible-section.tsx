"use client";

import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A Today section whose heading folds it away (Overdue, feature 07 §7.1). The heading is a button
 * with `aria-expanded`; the count stays visible while folded. Starts open.
 */
export function CollapsibleSection({
  id,
  label,
  count,
  alarm,
  children,
}: {
  id: string;
  label: string;
  count: number;
  alarm?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="pb-2 type-label-caps text-muted-foreground">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
          className="-ml-1 flex h-11 cursor-pointer items-center gap-1.5 rounded-sm px-1 type-label-caps hover:text-foreground md:h-auto"
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform duration-150", open && "rotate-90")}
            strokeWidth={1.5}
            aria-hidden
          />
          {label}
          <span className={cn("type-data-sm", alarm && "text-destructive")}>{count}</span>
        </button>
      </h2>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
