"use client";

import { useEffect } from "react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { initThreads } from "./threads";

/**
 * Loads this person's stored conversations once the page is in the browser (they live in
 * `localStorage`, which a server render cannot see). Renders nothing.
 */
export function AssistantBoot() {
  const { userId } = useWorkspace();
  useEffect(() => {
    if (userId) initThreads(userId);
  }, [userId]);
  return null;
}
