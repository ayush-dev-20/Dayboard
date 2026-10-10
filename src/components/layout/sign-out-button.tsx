"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { wipeAllAssistantData } from "@/components/assistant/threads";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();

  async function signOut() {
    // Assistant conversations live only in this browser; signing out removes them (feature 11 §3).
    wipeAllAssistantData();
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <button type="button" onClick={signOut} className={cn(className)}>
      <LogOut className="size-4" strokeWidth={1.5} aria-hidden /> Sign out
    </button>
  );
}
