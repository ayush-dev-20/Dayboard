import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { NAV_ITEMS } from "@/components/layout/nav-items";

export const metadata: Metadata = { title: "More" };

// Phone-sized destination for everything that doesn't fit the five bottom-nav slots.
const MORE_LINKS = NAV_ITEMS.filter((item) =>
  ["/projects", "/search", "/trash", "/settings"].includes(item.href),
);

export default function MorePage() {
  const rowClasses = "type-body-lg flex h-11 w-full items-center gap-3 border-b border-border";

  return (
    <div className="max-w-content">
      <PageHeader title="More" />
      <ul>
        {MORE_LINKS.map(({ href, label, icon: Icon }) => (
          <li key={href}>
            <Link href={href} className={rowClasses}>
              <Icon className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              {label}
            </Link>
          </li>
        ))}
        <li>
          <SignOutButton className={`${rowClasses} text-left text-muted-foreground`} />
        </li>
      </ul>
    </div>
  );
}
