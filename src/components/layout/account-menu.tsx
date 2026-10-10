"use client";

import { useRouter } from "next/navigation";
import { LogOut, SlidersHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/user-avatar";
import { wipeAllAssistantData } from "@/components/assistant/threads";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type Props = {
  name: string;
  email: string;
  /** `bar`: an avatar in the top bar. `sidebar`: avatar and name, the desktop account block. */
  variant?: "bar" | "sidebar";
  /** Sidebar rail: the avatar alone. */
  compact?: boolean;
};

export function AccountMenu({ name, email, variant = "bar", compact }: Props) {
  const router = useRouter();

  async function signOut() {
    // Assistant conversations live only in this browser; signing out removes them (feature 11 §3).
    wipeAllAssistantData();
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className={cn(
          "inline-flex cursor-pointer items-center",
          variant === "bar" || compact
            ? "size-11 justify-center rounded-full md:size-8"
            : "h-10 min-w-0 flex-1 gap-2 rounded-md px-2 text-left transition-colors duration-150 hover:bg-sidebar-accent",
        )}
      >
        <UserAvatar name={name} />
        {variant === "sidebar" && !compact ? (
          <span className="min-w-0 truncate type-label-md text-foreground">{name}</span>
        ) : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === "sidebar" ? "start" : "end"}
        side={variant === "sidebar" ? "top" : "bottom"}
      >
        <DropdownMenuLabel>
          <p className="truncate type-label-md">{name}</p>
          <p className="truncate type-body-sm text-muted-foreground">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <SlidersHorizontal strokeWidth={1.5} aria-hidden /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={signOut}>
          <LogOut strokeWidth={1.5} aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
