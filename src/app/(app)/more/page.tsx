import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { PageContainer } from "@/components/layout/page-container";
import { env } from "@/lib/env";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "More" };

// Phone-sized destination for everything that doesn't fit the five bottom-nav slots.
const MORE_LINKS = NAV_ITEMS.filter((item) =>
  ["/projects", "/assistant", "/search", "/trash", "/settings"].includes(item.href),
);

export default async function MorePage() {
  const user = await requireUser({ redirect: true });
  const aiOn = env.aiAvailable && (await getPreferences(user.id)).aiEnabled;
  const links = MORE_LINKS.filter((item) => aiOn || item.href !== "/assistant");
  const rowClasses = "type-body-lg flex h-11 w-full items-center gap-3 border-b border-border";

  return (
    <PageContainer>
      <PageHeader title="More" sticky={false} />
      <ul>
        {links.map(({ href, label, icon: Icon }) => (
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
    </PageContainer>
  );
}
