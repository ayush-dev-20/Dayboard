"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Tags joins this list in feature 03.
const TABS = [
  { href: "/settings/account", label: "Account" },
  { href: "/settings/appearance", label: "Appearance", short: "Look" },
  { href: "/settings/productivity", label: "Productivity" },
  { href: "/settings/ai", label: "AI" },
] as const;

export function SettingsTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings sections" className="border-b border-border">
      <ul className="-mb-px flex gap-5 overflow-x-auto">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-11 items-center border-b-2 type-body-md whitespace-nowrap md:h-9",
                  active
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {"short" in tab ? (
                  <>
                    <span className="md:hidden">{tab.short}</span>
                    <span className="hidden md:inline">{tab.label}</span>
                  </>
                ) : (
                  tab.label
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
