import type { Metadata } from "next";
import { CaptureLauncher } from "@/components/voice/capture-launcher";

export const metadata: Metadata = { title: "Capture" };

// The address the installed app's "Quick capture" shortcut opens (V2 feature 13 §3). It shows nothing of
// its own: it opens the voice recorder (with `?voice=1`, when voice is on) or the quick capture box, and
// sends the person to Today behind it.
export default function CapturePage() {
  return <CaptureLauncher />;
}
