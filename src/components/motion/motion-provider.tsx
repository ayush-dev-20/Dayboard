"use client";

import { MotionConfig } from "motion/react";

/**
 * `reducedMotion="user"`: for people who ask the system for less motion, Motion turns off
 * transform and layout animation and keeps gentle opacity and color changes. The global
 * `prefers-reduced-motion` block in globals.css is the second safety net for CSS transitions.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
