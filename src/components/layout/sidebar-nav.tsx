"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { useCommandMenu } from "@/components/command/command-context";
import { Counter } from "@/components/motion/counter";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { ColorDot } from "@/components/workspace/tokens";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand";
import { isActive, NAV_GROUPS, SIDEBAR_PROJECTS } from "./nav-items";
import { useSidebar } from "./sidebar-state";

type Props = {
  /** Called after a link is chosen, so the tablet sheet can close itself. */
  onNavigate?: () => void;
  /** The desktop sidebar can collapse to a rail; the tablet sheet is always full. */
  collapsible?: boolean;
  /** The account block at the bottom (desktop only; tablet and phone keep it in the top bar). */
  account?: React.ReactNode;
};

const itemBase =
  "flex h-11 cursor-pointer items-center gap-3 rounded-md px-2 transition-colors duration-150 lg:h-8";

/**
 * Wordmark, quick actions and the grouped links (Plan, Library, then Search, Trash, Settings), with
 * up to five active projects under Projects. Shared by the desktop sidebar and the tablet sheet.
 * Collapsed, it is a 56px rail of icons whose labels show as tooltips (and stay accessible names).
 */
export function SidebarNav({ onNavigate, collapsible = false, account }: Props) {
  const pathname = usePathname();
  const command = useCommandMenu();
  const { counts, projects } = useWorkspace();
  const { collapsed: collapsedState, toggle } = useSidebar();
  const collapsed = collapsible && collapsedState;
  const countFor: Record<string, number> = { "/today": counts.today, "/inbox": counts.inbox };
  const active = projects.filter((p) => p.status === "ACTIVE");
  const shown = active.slice(0, SIDEBAR_PROJECTS);

  return (
    <div className={cn("flex h-full flex-col py-4", collapsed ? "items-center px-2" : "px-3")}>
      <div className={cn("mb-4 flex items-center", collapsed ? "flex-col gap-2" : "gap-2 px-2")}>
        <Link
          href="/today"
          onClick={onNavigate}
          aria-label="Dayboard, go to Today"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md"
        >
          <BrandMark className="size-6 shrink-0" />
          {collapsed ? null : (
            <span className="truncate text-[17px] font-semibold tracking-tight text-foreground">
              Dayboard
            </span>
          )}
        </Link>
        {collapsible ? (
          <Tooltip
            side={collapsed ? "right" : "bottom"}
            label={
              <span className="flex items-center gap-2">
                {collapsed ? "Expand sidebar" : "Collapse sidebar"} <Kbd>⌘\</Kbd>
              </span>
            }
          >
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-keyshortcuts="Meta+\ Control+\"
              className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground"
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" strokeWidth={1.5} aria-hidden />
              ) : (
                <PanelLeftClose className="size-4" strokeWidth={1.5} aria-hidden />
              )}
            </button>
          </Tooltip>
        ) : null}
      </div>

      <div className={cn("mb-4 flex flex-col gap-0.5", collapsed && "items-center")}>
        {(
          [
            { mode: "capture", label: "Quick capture", strong: true },
            { mode: "create", label: "Create", strong: false },
          ] as const
        ).map((action) => (
          <Tooltip key={action.mode} label={action.label} disabled={!collapsed}>
            <button
              type="button"
              aria-label={collapsed ? action.label : undefined}
              onClick={() => {
                onNavigate?.();
                command.open(action.mode);
              }}
              className={cn(
                itemBase,
                "hover:bg-sidebar-accent hover:text-foreground",
                collapsed ? "w-10 justify-center px-0" : "w-full",
                action.strong
                  ? "type-label-md text-foreground"
                  : "type-body-md text-muted-foreground",
              )}
            >
              <Plus className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
              {collapsed ? null : action.label}
            </button>
          </Tooltip>
        ))}
      </div>

      <nav
        aria-label="Primary"
        className={cn("min-h-0 flex-1 overflow-y-auto", collapsed && "w-full")}
      >
        {NAV_GROUPS.map((group, index) => (
          <div key={group.label ?? "more"} className={cn(index > 0 && "mt-4")}>
            {group.label && !collapsed ? (
              <p className="mb-1 px-2 type-label-caps text-muted-foreground">{group.label}</p>
            ) : index > 0 && collapsed ? (
              <div aria-hidden className="mx-auto mb-4 h-px w-6 bg-border" />
            ) : null}
            <ul className={cn("flex flex-col gap-0.5", collapsed && "items-center")}>
              {group.items.map(({ href, label, icon: Icon }) => {
                const here = isActive(pathname, href);
                const count = countFor[href];
                return (
                  <li key={href} className={cn(collapsed && "w-full")}>
                    <Tooltip label={count ? `${label} · ${count}` : label} disabled={!collapsed}>
                      <Link
                        href={href}
                        onClick={onNavigate}
                        aria-current={here ? "page" : undefined}
                        aria-label={collapsed ? (count ? `${label}, ${count}` : label) : undefined}
                        className={cn(
                          itemBase,
                          "relative",
                          collapsed && "mx-auto w-10 justify-center px-0",
                          here
                            ? "bg-sidebar-primary type-label-md text-sidebar-primary-foreground"
                            : "type-body-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                        )}
                      >
                        <Icon className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
                        {collapsed ? (
                          count ? (
                            <span
                              aria-hidden
                              className="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
                            />
                          ) : null
                        ) : (
                          <>
                            {label}
                            {count ? (
                              <span className="ml-auto type-data-sm text-muted-foreground">
                                <span className="sr-only">, </span>
                                <Counter value={count} />
                              </span>
                            ) : null}
                          </>
                        )}
                      </Link>
                    </Tooltip>
                    {href === "/projects" && !collapsed && shown.length > 0 ? (
                      <ul className="mt-0.5 flex flex-col gap-0.5">
                        {shown.map((project) => {
                          const projectHref = `/projects/${project.id}`;
                          const onProject = isActive(pathname, projectHref);
                          return (
                            <li key={project.id}>
                              <Link
                                href={projectHref}
                                onClick={onNavigate}
                                aria-current={onProject ? "page" : undefined}
                                className={cn(
                                  itemBase,
                                  "pl-8 type-body-sm",
                                  onProject
                                    ? "bg-sidebar-accent text-foreground"
                                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                                )}
                              >
                                <ColorDot color={project.color} />
                                <span className="truncate">{project.name}</span>
                              </Link>
                            </li>
                          );
                        })}
                        {active.length > SIDEBAR_PROJECTS ? (
                          <li>
                            <Link
                              href="/projects"
                              onClick={onNavigate}
                              className={cn(
                                itemBase,
                                "pl-8 type-body-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                              )}
                            >
                              Show all ({active.length})
                            </Link>
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {account ? (
        <div className={cn("mt-4 w-full", collapsed && "flex justify-center")}>{account}</div>
      ) : null}
    </div>
  );
}
