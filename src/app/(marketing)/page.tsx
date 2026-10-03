import type { Metadata } from "next";
import {
  AiFirst,
  Faq,
  FeatureRows,
  FinalCta,
  Hero,
  KeyboardStrip,
  Loop,
  Privacy,
} from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: { absolute: "Dayboard: capture anything, act on what matters" },
  description:
    "A calm personal workspace for tasks, todos, notes and projects: one page for today, one key to capture, and AI that asks before it changes anything.",
};

// Static by design: no cookies, headers or data here (feature 07 §10.4).
export const dynamic = "force-static";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <Loop />
      <FeatureRows />
      <AiFirst />
      <KeyboardStrip />
      <Privacy />
      <Faq />
      <FinalCta />
    </>
  );
}
