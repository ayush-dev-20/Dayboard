"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActive, NAV_ITEMS } from "./nav-items";

type Props = {
  /** Called after a link is chosen, so the tablet sheet can close itself. */
  onNavigate?: () => void;
};

/** Wordmark, quick actions and the primary links. Shared by the desktop sidebar and the tablet sheet. */
export function SidebarNav({ onNavigate }: Props) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col px-3 py-5">
      <Link
        href="/today"
        onClick={onNavigate}
        className="mb-5 px-2 font-serif text-xl font-semibold tracking-tight [font-variation-settings:'opsz'_24]"
      >
        Dayboard
      </Link>

      {/* Wired up in later features (Quick capture: 04, Create: 02/03). Disabled until then. */}
      <div className="mb-5 flex flex-col gap-0.5">
        <button
          type="button"
          disabled
          title="Coming soon"
          className="flex h-8 items-center gap-3 rounded-md px-2 type-label-md text-foreground disabled:opacity-60"
        >
          <Plus className="size-4" strokeWidth={1.5} aria-hidden /> Quick capture
        </button>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="flex h-8 items-center gap-3 rounded-md px-2 type-body-md text-muted-foreground disabled:opacity-60"
        >
          <Plus className="size-4" strokeWidth={1.5} aria-hidden /> Create
        </button>
      </div>

      <nav aria-label="Primary">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-md px-2 transition-colors duration-[120ms] lg:h-8",
                    active
                      ? "bg-primary-subtle type-label-md text-primary"
                      : "type-body-md text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.5} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
