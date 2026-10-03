"use client";

import { AnimatePresence, motion } from "motion/react";
import { duration } from "@/lib/motion";

/** A number that crossfades (120ms) when it changes, like the sidebar's Today and Inbox counts. */
export function Counter({ value, className }: { value: number; className?: string }) {
  return (
    <span className={className} style={{ display: "inline-grid" }}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: duration.fast }}
          style={{ gridArea: "1 / 1" }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
