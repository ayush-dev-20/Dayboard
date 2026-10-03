import { cn } from "@/lib/utils";

// Loading placeholders shaped like the real content (feature 07 §7.6), so the page doesn't jump
// when it arrives. The shimmer only runs when the person allows motion (`skeleton` utility).

function Bar({ className }: { className?: string }) {
  return <div aria-hidden className={cn("h-3 skeleton", className)} />;
}

function Shell({
  label,
  width = "content",
  children,
}: {
  label: string;
  width?: "content" | "wide";
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={cn("mx-auto w-full", width === "wide" ? "max-w-wide" : "max-w-content")}
    >
      {children}
    </div>
  );
}

function HeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 md:pt-3">
      <div className="flex flex-col gap-2">
        <Bar className="hidden h-7 w-40 md:block" />
        <Bar className="w-20" />
      </div>
      {action ? <div aria-hidden className="hidden h-8 w-28 skeleton rounded-md md:block" /> : null}
    </div>
  );
}

export function RowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="border-t border-border">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex min-h-row-touch items-center gap-3 border-b border-border px-3 md:min-h-row"
        >
          <div aria-hidden className="size-[18px] shrink-0 skeleton rounded-sm" />
          <Bar className={cn("w-1/2", i % 3 === 1 && "w-2/3", i % 3 === 2 && "w-1/3")} />
          <Bar className="ml-auto w-12" />
        </div>
      ))}
    </div>
  );
}

/** Tasks, Inbox, Search, Trash, Settings: a header and rows. */
export function ListPageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <Shell label={label}>
      <HeaderSkeleton />
      <Bar className="mb-8 h-8 w-64 rounded-md" />
      <Bar className="mb-3 w-20" />
      <RowsSkeleton />
    </Shell>
  );
}

/** Projects and the Notes grid: a header and cards. */
export function GridPageSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <Shell label={label} width="wide">
      <HeaderSkeleton />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex h-44 flex-col gap-3 card p-4">
            <Bar className="h-4 w-1/2" />
            <Bar className="w-5/6" />
            <Bar className="mt-auto h-1.5 w-full rounded-full" />
            <Bar className="w-1/3" />
          </div>
        ))}
      </div>
    </Shell>
  );
}

/** Today: greeting, capture, the focus card and two sections. */
export function TodaySkeleton() {
  return (
    <Shell label="Loading Today" width="wide">
      <div className="xl:grid xl:grid-cols-[minmax(0,720px)_var(--spacing-today-rail)] xl:justify-between xl:gap-12">
        <div>
          <div className="mb-8 flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Bar className="h-9 w-72 max-w-full" />
              <Bar className="w-40" />
            </div>
            <div aria-hidden className="size-11 shrink-0 skeleton rounded-full" />
          </div>
          <div aria-hidden className="h-12 skeleton rounded-lg" />
          <div aria-hidden className="mt-6 h-40 skeleton rounded-xl" />
          <div className="mt-10">
            <Bar className="mb-3 w-20" />
            <RowsSkeleton rows={4} />
          </div>
        </div>
        <div className="mt-12 hidden flex-col gap-3 xl:mt-0 xl:flex">
          <Bar className="w-16" />
          <RowsSkeleton rows={3} />
        </div>
      </div>
    </Shell>
  );
}

/** The note editor: a title and a few lines of prose at the reading measure. */
export function EditorSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading note"
      className="mx-auto w-full max-w-editor"
    >
      <Bar className="mb-8 w-32" />
      <Bar className="mb-6 h-9 w-2/3" />
      {["w-full", "w-11/12", "w-4/5", "w-full", "w-2/3"].map((w, i) => (
        <Bar key={i} className={cn("mb-3 h-3.5", w)} />
      ))}
    </div>
  );
}
