"use client";

import { motion } from "motion/react";
import { routeFade } from "@/lib/motion";

// A template re-mounts on every navigation, so each page fades in (120ms, opacity only). Pages
// never slide; under reduced motion the fade stays and nothing moves.
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={routeFade.initial} animate={routeFade.animate} data-route-fade>
      {children}
    </motion.div>
  );
}
