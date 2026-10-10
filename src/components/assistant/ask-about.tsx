"use client";

import { MessageCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { ContextRef } from "@/lib/ai/assistant-types";
import { startChatAbout } from "./chips";
import { setLauncherOpen } from "./launcher-state";

/**
 * "Ask about this" (V2 feature 11 §6A): starts a new chat about one note, task or project, with the
 * item as a visible, removable chip. It opens the floating panel, or the Assistant page when the
 * button is hidden (Settings) or the person is already on that page. This is also the keyboard and
 * touch way to do what dragging an item onto the button does.
 */
export function useAskAbout() {
  const router = useRouter();
  const pathname = usePathname();
  const { assistantLauncher } = useWorkspace();
  return useCallback(
    async (ref: ContextRef) => {
      const id = await startChatAbout([ref]);
      if (!id) return;
      if (assistantLauncher && !pathname.startsWith("/assistant")) setLauncherOpen(true);
      else router.push("/assistant");
    },
    [assistantLauncher, pathname, router],
  );
}

/** The menu item. Renders nothing while AI is off (every assistant surface is hidden then). */
export function AskAboutMenuItem({ type, id, onBefore }: ContextRef & { onBefore?: () => void }) {
  const { aiEnabled } = useWorkspace();
  const askAbout = useAskAbout();
  if (!aiEnabled) return null;
  return (
    <DropdownMenuItem
      onSelect={() => {
        onBefore?.();
        void askAbout({ type, id });
      }}
    >
      <MessageCircle strokeWidth={1.5} aria-hidden /> Ask about this
    </DropdownMenuItem>
  );
}
