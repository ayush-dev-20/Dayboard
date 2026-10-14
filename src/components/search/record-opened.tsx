"use client";

import { useEffect } from "react";
import { rememberOpened, type RecentType } from "@/lib/search/recent-items";

/** Remembers, in this browser only, that the person opened this item (feature 10 §2). Renders nothing. */
export function RecordOpened({ type, id }: { type: RecentType; id: string }) {
  useEffect(() => {
    rememberOpened(type, id);
  }, [type, id]);
  return null;
}
