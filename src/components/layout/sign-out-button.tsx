"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { wipeAllAssistantData } from "@/components/assistant/threads";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { authClient } from "@/lib/auth-client";
import { revokeThisDeviceOnSignOut } from "@/lib/notifications/client";
import { confirmAndWipeRecordings } from "@/lib/voice/client/sign-out";
import { clearWorkerCaches } from "@/lib/pwa/clear-caches";
import { cn } from "@/lib/utils";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const { userId } = useWorkspace();

  async function signOut() {
    // Voice recordings waiting on this device are removed too (feature 13 §9), after asking if any are unsent.
    if (!(await confirmAndWipeRecordings(userId))) return;
    // Assistant conversations live only in this browser; signing out removes them (feature 11 §3).
    wipeAllAssistantData();
    // This device stops receiving this person's notifications (feature 14 §5), while the session can still say so.
    await revokeThisDeviceOnSignOut();
    // The offline caches hold this person's pages and data (feature 03 §6).
    await clearWorkerCaches();
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
