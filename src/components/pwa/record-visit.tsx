"use client";

import { useEffect } from "react";
import { countVisit } from "@/lib/pwa/visits";

/** Counts this app open for the install tip (V2 feature 03 §5). Renders nothing. */
export function RecordVisit() {
  useEffect(() => {
    countVisit();
  }, []);
  return null;
}
