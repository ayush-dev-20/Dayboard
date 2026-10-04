"use client";

import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  CheckSquare,
  CircleCheck,
  FileText,
  Folder,
  History,
  MessageCircleQuestion,
  Plus,
  Search,
  Tag as TagIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AskPanel } from "@/components/ai/ask-panel";
import { useAIStream } from "@/components/ai/use-ai";
import { Kbd } from "@/components/ui/kbd";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { ProjectToken } from "@/components/workspace/tokens";
import { forgetSearches, readRecentSearches, rememberSearch } from "@/lib/search/recent";
import { looksLikeQuestion, parseQuery } from "@/lib/search/query";
import {
  SEARCH_TYPES,
  type SearchHit,
  type SearchResults,
  type SearchType,
} from "@/lib/search/types";
import { cn } from "@/lib/utils";
import { saveToInbox } from "./capture";
import { CaptureBox } from "./capture-box";
import type { CommandMode } from "./command-context";

const GROUP_LABELS: Record<SearchType, string> = {
  task: "Tasks",
  todo: "Todos",
  note: "Notes",
  project: "Projects",
  tag: "Tags",
};

const ICONS = {
  task: CheckSquare,
  todo: CircleCheck,
  note: FileText,
  project: Folder,
  tag: TagIcon,
} as const;

const QUICK_ACTIONS = [
  { id: "new-task", label: "New task", href: "/tasks?focus=add" },
  { id: "new-todo", label: "New todo", href: "/tasks?view=todos&focus=add" },
  { id: "new-note", label: "New note", href: "/notes/new" },
  { id: "new-project", label: "New project", href: "/projects?new=1" },
] as const;

type Props = { mode: CommandMode; onModeChange: (mode: CommandMode) => void; onClose: () => void };

function HitRow({ hit, onSelect }: { hit: SearchHit; onSelect: (hit: SearchHit) => void }) {
  const Icon = ICONS[hit.type];
  return (
    <Command.Item
      value={`${hit.type}:${hit.id}`}
      onSelect={() => onSelect(hit)}
      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 type-body-md data-[selected=true]:bg-primary-subtle md:min-h-9"
    >
      <span aria-hidden className="inline-flex w-5 shrink-0 justify-center">
        {hit.emoji ?? <Icon className="size-4 text-muted-foreground" strokeWidth={1.5} />}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {hit.title}
        {hit.snippet ? (
          <span className="ml-2 type-body-sm text-muted-foreground">
            {hit.snippet.before}
            <mark className="rounded-[2px] bg-primary-subtle px-0.5 text-foreground">
              {hit.snippet.match}
            </mark>
            {hit.snippet.after}
          </span>
        ) : null}
        {hit.archived ? (
          <span className="ml-2 type-label-caps text-muted-foreground">Archived</span>
        ) : null}
        {hit.type === "tag" ? (
          <span className="ml-2 type-body-sm text-muted-foreground">
            {hit.taskCount} {hit.taskCount === 1 ? "task" : "tasks"}, {hit.noteCount}{" "}
            {hit.noteCount === 1 ? "note" : "notes"}
          </span>
        ) : null}
      </span>
      {hit.project ? <ProjectToken project={hit.project} className="max-w-32 shrink-0" /> : null}
    </Command.Item>
  );
}

/**
 * The one command menu: Search (default) and Create, with quick capture one keystroke away. Search
 * results come from `/api/search` (150 ms debounce, the previous request is cancelled by the next
 * keystroke). Built on cmdk; filtering happens on the server, so cmdk's own filter is off.
 * "Ask" (feature 05) streams an answer from the person's own workspace; it is only offered when AI
 * is available and switched on.
 */
export function CommandMenu({ mode, onModeChange, onClose }: Props) {
  const router = useRouter();
  const { aiEnabled } = useWorkspace();
  const ask = useAIStream("/api/ai/ask");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [recent, setRecent] = useState<SearchHit[]>([]);
  // Mounted only while open, so these start fresh every time.
  const [searches, setSearches] = useState<string[]>(() => readRecentSearches());
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const parsed = parseQuery(query);

  // Recent items are loaded as soon as the menu opens.
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/search?recent=1", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { recent?: SearchHit[] } | null) => setRecent(body?.recent ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  function search(text: string) {
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    if (!parseQuery(text).ok) {
      setResults(null);
      setFailed(false);
      return;
    }
    timer.current = setTimeout(async () => {
      const controller = new AbortController();
      abort.current = controller;
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(text)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("search failed");
        const body = (await response.json()) as { results: SearchResults | null };
        setResults(body.results);
        setFailed(false);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setFailed(true);
      }
    }, 150);
  }

  // Without AI there is no Ask tab, and a stale Ask request (AI switched off while open) falls back.
  const modes: readonly CommandMode[] = aiEnabled
    ? (["search", "ask", "create"] as const)
    : (["search", "create"] as const);
  const asking = mode === "ask" && aiEnabled;

  function submitQuestion() {
    const question = query.trim();
    if (question.length < 2) return;
    ask.run({ question });
  }

  function close() {
    if (timer.current) clearTimeout(timer.current);
    abort.current?.abort();
    setQuery("");
    setResults(null);
    onClose();
  }

  function go(href: string) {
    rememberSearch(query);
    close();
    router.push(href);
  }

  async function captureTyped() {
    const text = query.trim();
    if (!text) return;
    close();
    const attempt = async (): Promise<void> => {
      const result = await saveToInbox(text);
      if (result.ok) toast("Saved to Inbox.");
      else {
        // The menu is already closed, so the words travel with the Retry button instead of being lost.
        toast.error("Couldn't save to Inbox.", {
          action: { label: "Retry", onClick: () => void attempt() },
        });
      }
    };
    await attempt();
  }

  const rows = results ? SEARCH_TYPES.filter((t) => results[t].length > 0) : [];
  const typed = query.trim().length > 0;

  return (
    <DialogPrimitive.Root open onOpenChange={(next) => !next && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-70 bg-scrim duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            // The input inside takes focus itself.
            if (mode === "capture") e.preventDefault();
          }}
          className={cn(
            "fixed z-70 flex flex-col overflow-hidden bg-overlay text-foreground outline-none float-surface",
            // Fade and scale 0.98 → 1 in 160ms.
            "duration-160 ease-(--ease-enter) data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-safe:md:data-[state=open]:zoom-in-98",
            // Phone: the whole screen. Larger: a centered dialog near the top.
            "max-md:inset-0 md:top-32 md:left-1/2 md:max-h-[min(560px,calc(100dvh-10rem))] md:w-[640px] md:max-w-[calc(100vw-32px)] md:-translate-x-1/2 md:rounded-lg md:shadow-float md:dark:border md:dark:border-border",
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {mode === "capture" ? "Quick capture" : "Search, ask or create"}
          </DialogPrimitive.Title>

          {mode === "capture" ? (
            <CaptureBox initialText={query} onDone={close} onClose={close} />
          ) : (
            <Command
              shouldFilter={false}
              loop
              label="Search, ask or create"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void captureTyped();
                } else if (e.key === "Enter" && asking) {
                  e.preventDefault();
                  submitQuestion();
                } else if (e.key === "Tab") {
                  // Tab moves between Search, Ask (when AI is on) and Create.
                  e.preventDefault();
                  const at = modes.indexOf(mode);
                  onModeChange(modes[(at + 1) % modes.length]!);
                }
              }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex items-center gap-3 border-b border-border px-4">
                <Search
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                  aria-hidden
                />
                <Command.Input
                  autoFocus
                  value={query}
                  onValueChange={(text) => {
                    setQuery(text);
                    if (!asking) search(text);
                  }}
                  placeholder={
                    mode === "create"
                      ? "Create something…"
                      : asking
                        ? "Ask about your workspace"
                        : "Search, ask or create"
                  }
                  className="h-12 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground md:text-[14px]"
                />
                <Kbd>esc</Kbd>
              </div>

              <div
                role="tablist"
                aria-label="Mode"
                className="flex gap-4 border-b border-border px-4"
              >
                {modes.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={mode === m}
                    onClick={() => onModeChange(m)}
                    className={cn(
                      "-mb-px h-10 border-b-2 type-body-md capitalize",
                      mode === m
                        ? "border-primary font-semibold text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {asking ? (
                <div className="max-h-[min(420px,calc(100dvh-14rem))] min-h-0 overflow-y-auto max-md:max-h-none max-md:flex-1">
                  <AskPanel
                    state={ask.state}
                    onRetry={ask.retry}
                    onDismiss={ask.reset}
                    onOpen={(href) => go(href)}
                  />
                </div>
              ) : null}

              <Command.List
                hidden={asking}
                className="max-h-[min(380px,calc(100dvh-14rem))] min-h-0 overflow-y-auto p-2 max-md:max-h-none max-md:flex-1"
              >
                {typed ? (
                  <Command.Item
                    value="capture"
                    onSelect={() => void captureTyped()}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 type-body-md data-[selected=true]:bg-primary-subtle md:min-h-9"
                  >
                    <Plus
                      className="size-4 shrink-0 text-muted-foreground"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">
                      Capture “{query.trim()}” to Inbox
                    </span>
                    <Kbd className="max-md:hidden">⌘↵</Kbd>
                  </Command.Item>
                ) : null}

                {mode === "create" || !typed ? (
                  <Command.Group
                    heading={
                      <span className="type-label-caps text-muted-foreground">
                        {mode === "create" ? "Create" : "Quick actions"}
                      </span>
                    }
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1"
                  >
                    {QUICK_ACTIONS.map((action) => (
                      <Command.Item
                        key={action.id}
                        value={action.id}
                        onSelect={() => go(action.href)}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 type-body-md data-[selected=true]:bg-primary-subtle md:min-h-9"
                      >
                        <Plus
                          className="size-4 text-muted-foreground"
                          strokeWidth={1.5}
                          aria-hidden
                        />{" "}
                        {action.label}
                      </Command.Item>
                    ))}
                    {aiEnabled ? (
                      <Command.Item
                        value="write-note-with-ai"
                        onSelect={() => go("/notes/new?ai=1")}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 type-body-md data-[selected=true]:bg-primary-subtle md:min-h-9"
                      >
                        <Plus
                          className="size-4 text-muted-foreground"
                          strokeWidth={1.5}
                          aria-hidden
                        />{" "}
                        Write a note with AI
                      </Command.Item>
                    ) : null}
                    <Command.Item
                      value="capture-mode"
                      onSelect={() => onModeChange("capture")}
                      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 type-body-md data-[selected=true]:bg-primary-subtle md:min-h-9"
                    >
                      <Plus
                        className="size-4 text-muted-foreground"
                        strokeWidth={1.5}
                        aria-hidden
                      />{" "}
                      Capture to Inbox
                      <Kbd className="ml-auto max-md:hidden">C</Kbd>
                    </Command.Item>
                  </Command.Group>
                ) : null}

                {!typed && mode === "search" && searches.length > 0 ? (
                  <Command.Group
                    heading={
                      <span className="type-label-caps text-muted-foreground">Recent searches</span>
                    }
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1"
                  >
                    {searches.map((s) => (
                      <Command.Item
                        key={s}
                        value={`recent-search:${s}`}
                        onSelect={() => {
                          setQuery(s);
                          search(s);
                        }}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 type-body-md data-[selected=true]:bg-primary-subtle md:min-h-9"
                      >
                        <History
                          className="size-4 text-muted-foreground"
                          strokeWidth={1.5}
                          aria-hidden
                        />{" "}
                        {s}
                      </Command.Item>
                    ))}
                    <Button
                      variant="secondary"
                      onClick={() => {
                        forgetSearches();
                        setSearches([]);
                      }}
                      className="mx-2 mt-1"
                    >
                      Clear recent searches
                    </Button>
                  </Command.Group>
                ) : null}

                {!typed && mode === "search" && recent.length > 0 ? (
                  <Command.Group
                    heading={
                      <span className="type-label-caps text-muted-foreground">Recent items</span>
                    }
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1"
                  >
                    {recent.map((hit) => (
                      <HitRow
                        key={`${hit.type}:${hit.id}`}
                        hit={hit}
                        onSelect={(h) => go(h.href)}
                      />
                    ))}
                  </Command.Group>
                ) : null}

                {mode === "search" && typed
                  ? rows.map((type) => (
                      <Command.Group
                        key={type}
                        heading={
                          <span className="type-label-caps text-muted-foreground">
                            {GROUP_LABELS[type]}
                          </span>
                        }
                        className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1"
                      >
                        {results![type].map((hit) => (
                          <HitRow
                            key={`${hit.type}:${hit.id}`}
                            hit={hit}
                            onSelect={(h) => go(h.href)}
                          />
                        ))}
                      </Command.Group>
                    ))
                  : null}

                {/* A visible way into Ask, without a new global key: a sentence-like query offers it last. */}
                {mode === "search" && aiEnabled && looksLikeQuestion(query) ? (
                  <Command.Group
                    heading={<span className="type-label-caps text-muted-foreground">Ask</span>}
                    className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1"
                  >
                    <Command.Item
                      value="ask-workspace"
                      onSelect={() => {
                        onModeChange("ask");
                        ask.run({ question: query.trim() });
                      }}
                      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 type-body-md data-[selected=true]:bg-primary-subtle md:min-h-9"
                    >
                      <MessageCircleQuestion
                        className="size-4 shrink-0 text-muted-foreground"
                        strokeWidth={1.5}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate">
                        Ask your workspace: “{query.trim()}”
                      </span>
                      <Kbd className="max-md:hidden">↵</Kbd>
                    </Command.Item>
                  </Command.Group>
                ) : null}

                {mode === "search" &&
                typed &&
                parsed.ok &&
                results &&
                results.total === 0 &&
                !failed ? (
                  <p className="px-2 py-2 type-body-sm text-muted-foreground" role="status">
                    Nothing matches “{parsed.q}”.
                  </p>
                ) : null}
                {mode === "search" && typed && !parsed.ok && parsed.reason === "too_short" ? (
                  <p className="px-2 py-2 type-body-sm text-muted-foreground">
                    Keep typing to search.
                  </p>
                ) : null}
                {failed ? (
                  <p role="alert" className="px-2 py-2 type-body-sm text-destructive">
                    Search isn’t responding. You can still capture this to Inbox.
                  </p>
                ) : null}
              </Command.List>

              {mode === "search" && typed && results && results.total > 0 ? (
                <div className="border-t border-border px-4 py-2">
                  <Button
                    variant="secondary"
                    onClick={() => go(`/search?q=${encodeURIComponent(query.trim())}`)}
                  >
                    See all results on the Search page
                  </Button>
                </div>
              ) : null}
            </Command>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
