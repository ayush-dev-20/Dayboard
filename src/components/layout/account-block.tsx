"use client";

import { AccountMenu } from "./account-menu";
import { useSidebar } from "./sidebar-state";
import { ThemeToggle } from "./theme-toggle";

/** Bottom of the desktop sidebar: avatar and name (the account menu) and the theme switch. */
export function AccountBlock({ name, email }: { name: string; email: string }) {
  const { collapsed } = useSidebar();
  if (collapsed) return <AccountMenu name={name} email={email} variant="sidebar" compact />;
  return (
    <div className="flex items-center gap-1 border-t border-sidebar-border pt-3">
      <AccountMenu name={name} email={email} variant="sidebar" />
      <ThemeToggle />
    </div>
  );
}
