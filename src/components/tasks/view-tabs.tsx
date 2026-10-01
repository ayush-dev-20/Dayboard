import Link from "next/link";
import { cn } from "@/lib/utils";

/** Tasks | Todos as text tabs: the active one is on-surface, semibold, with an ink-blue underline. */
export function ViewTabs({ active }: { active: "tasks" | "todos" }) {
  const tabs = [
    { key: "tasks", label: "Tasks", href: "/tasks" },
    { key: "todos", label: "Todos", href: "/tasks?view=todos" },
  ] as const;

  return (
    <nav aria-label="Tasks or todos" className="border-b border-border">
      <ul className="-mb-px flex gap-5">
        {tabs.map((tab) => (
          <li key={tab.key}>
            <Link
              href={tab.href}
              aria-current={active === tab.key ? "page" : undefined}
              className={cn(
                "flex h-11 items-center border-b-2 type-body-md md:h-9",
                active === tab.key
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
