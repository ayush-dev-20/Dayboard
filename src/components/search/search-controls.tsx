"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Calendar, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ColorDot } from "@/components/workspace/tokens";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { addDays } from "@/lib/dates/calendar";
import { buildSearchUrl } from "@/lib/search/params";
import { SEARCH_TABS, type SearchParams, type SearchTab } from "@/lib/search/types";
import { STATUS_LABELS, TASK_STATUSES, type TaskStatus } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

const TAB_LABELS: Record<SearchTab, string> = {
  all: "All",
  task: "Tasks",
  todo: "Todos",
  note: "Notes",
  project: "Projects",
};

const trigger =
  "type-body-md inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-muted-foreground hover:bg-accent hover:text-foreground md:h-8";

/** The query box (a plain form, so Enter works without scripts) and the type tabs. */
export function SearchBox({ params }: { params: SearchParams }) {
  const hidden = buildSearchUrl({ ...params, q: undefined });
  const kept = new URLSearchParams(hidden.split("?")[1] ?? "");
  return (
    <>
      <form action="/search" method="get" role="search" className="relative">
        {[...kept.entries()].map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden
        />
        <input
          name="q"
          type="search"
          defaultValue={params.q}
          aria-label="Search"
          placeholder="Search tasks, todos, notes, projects and tags"
          autoComplete="off"
          maxLength={200}
          className="h-11 w-full rounded-md border border-input bg-background pr-3 pl-9 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-primary md:h-9 md:text-[14px]"
        />
      </form>

      <nav aria-label="Result type" className="mt-4 border-b border-border">
        <ul className="-mb-px flex gap-5 overflow-x-auto">
          {SEARCH_TABS.map((tab) => (
            <li key={tab}>
              <Link
                href={buildSearchUrl({ ...params, tab })}
                aria-current={params.tab === tab ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center border-b-2 type-body-md whitespace-nowrap md:h-9",
                  params.tab === tab
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {TAB_LABELS[tab]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

type Preset = {
  id: string;
  label: string;
  range: (today: string) => { from: string | null; to: string | null };
};
const PRESETS: Preset[] = [
  { id: "any", label: "Any time", range: () => ({ from: null, to: null }) },
  { id: "today", label: "Today", range: (t) => ({ from: t, to: t }) },
  { id: "past7", label: "Past 7 days", range: (t) => ({ from: addDays(t, -7), to: t }) },
  { id: "next7", label: "Next 7 days", range: (t) => ({ from: t, to: addDays(t, 7) }) },
  { id: "past30", label: "Past 30 days", range: (t) => ({ from: addDays(t, -30), to: t }) },
];

/** Status, project, tag and date range. Every choice lives in the URL. */
export function SearchFilters({ params, today }: { params: SearchParams; today: string }) {
  const router = useRouter();
  const { projects, tags } = useWorkspace();
  const project = projects.find((p) => p.id === params.projectId);
  const tag = tags.find((t) => t.id === params.tagId);

  const go = (patch: Partial<SearchParams>) =>
    router.replace(buildSearchUrl({ ...params, ...patch }), { scroll: false });

  const activePreset = PRESETS.find((p) => {
    const r = p.range(today);
    return r.from === params.from && r.to === params.to;
  });
  const dateLabel = activePreset
    ? activePreset.label
    : [params.from, params.to].filter(Boolean).join(" to ") || "Any time";
  const filtered = params.status || params.projectId || params.tagId || params.from || params.to;

  return (
    <div className="flex flex-wrap items-center gap-1 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger className={trigger}>
          Status{" "}
          <b className="font-semibold text-foreground">
            {params.status ? STATUS_LABELS[params.status] : "Any"}
          </b>
          <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          <DropdownMenuRadioGroup
            value={params.status ?? "any"}
            onValueChange={(v) => go({ status: v === "any" ? null : (v as TaskStatus) })}
          >
            <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
            {TASK_STATUSES.map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className={trigger}>
          Project{" "}
          <b className="font-semibold text-foreground">
            {params.projectId === "none" ? "No project" : (project?.name ?? "Any")}
          </b>
          <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 min-w-52 overflow-y-auto">
          <DropdownMenuRadioGroup
            value={params.projectId ?? "any"}
            onValueChange={(v) => go({ projectId: v === "any" ? null : v })}
          >
            <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="none">No project</DropdownMenuRadioItem>
            {projects.map((p) => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                <ColorDot color={p.color} /> {p.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className={trigger}>
          Tag <b className="font-semibold text-foreground">{tag?.name ?? "Any"}</b>
          <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 min-w-44 overflow-y-auto">
          <DropdownMenuRadioGroup
            value={params.tagId ?? "any"}
            onValueChange={(v) => go({ tagId: v === "any" ? null : v })}
          >
            <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
            {tags.map((t) => (
              <DropdownMenuRadioItem key={t.id} value={t.id}>
                {t.color ? <ColorDot color={t.color} /> : null} {t.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger className={trigger}>
          <Calendar className="size-4" strokeWidth={1.5} aria-hidden />
          Due / updated <b className="font-semibold text-foreground">{dateLabel}</b>
          <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <p className="mb-2 type-body-sm text-muted-foreground">
            Due date for tasks and todos, last update for notes and projects.
          </p>
          <div className="flex flex-col">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => go(preset.range(today))}
                className={cn(
                  "h-11 rounded-md px-2 text-left type-body-md hover:bg-accent md:h-8",
                  activePreset?.id === preset.id && "font-semibold text-primary",
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <form
            className="mt-3 flex flex-col gap-2 border-t border-border pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              go({
                from: (data.get("from") as string) || null,
                to: (data.get("to") as string) || null,
              });
            }}
          >
            <label className="flex items-center justify-between gap-2 type-body-sm">
              From
              <input
                type="date"
                name="from"
                defaultValue={params.from ?? ""}
                className="h-9 rounded-md border border-input bg-background px-2 text-[16px] md:h-8 md:text-[13px]"
              />
            </label>
            <label className="flex items-center justify-between gap-2 type-body-sm">
              To
              <input
                type="date"
                name="to"
                defaultValue={params.to ?? ""}
                className="h-9 rounded-md border border-input bg-background px-2 text-[16px] md:h-8 md:text-[13px]"
              />
            </label>
            <Button type="submit" variant="secondary">
              Apply range
            </Button>
          </form>
        </PopoverContent>
      </Popover>

      {filtered ? (
        <Link
          href={buildSearchUrl({ q: params.q, tab: params.tab })}
          className="px-2 type-body-md text-primary underline underline-offset-2"
        >
          Clear filters
        </Link>
      ) : null}
    </div>
  );
}
