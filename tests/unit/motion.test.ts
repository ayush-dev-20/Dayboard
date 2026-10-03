import { describe, expect, it } from "vitest";
import { MotionConfig } from "motion/react";
import { MotionProvider } from "@/components/motion/motion-provider";
import { LAYOUT_ROW_LIMIT, animateRows, duration, ease, gentle, snappy } from "@/lib/motion";

describe("motion setup (feature 07 §8)", () => {
  it("MotionProvider asks Motion to follow the person's reduced-motion setting", () => {
    const element = MotionProvider({ children: null });
    expect(element.type).toBe(MotionConfig);
    expect(element.props.reducedMotion).toBe("user");
  });

  it("keeps every duration within the budget (nothing over 0.5s)", () => {
    for (const value of Object.values(duration)) expect(value).toBeLessThanOrEqual(0.5);
    expect(ease.enter).toEqual([0.2, 0, 0, 1]);
    expect(ease.exit).toEqual([0.4, 0, 1, 1]);
  });

  it("uses springs without bounce", () => {
    expect(snappy).toMatchObject({ type: "spring", stiffness: 500, damping: 40 });
    expect(gentle).toMatchObject({ type: "spring", stiffness: 260, damping: 30 });
  });

  it("turns off per-row layout animation past 100 rows", () => {
    expect(LAYOUT_ROW_LIMIT).toBe(100);
    expect(animateRows(100)).toBe(true);
    expect(animateRows(101)).toBe(false);
  });
});
