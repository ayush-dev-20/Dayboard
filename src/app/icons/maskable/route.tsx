import { brandIcon } from "@/lib/pwa/icon-art";

// Maskable: the mark sits inside the safe zone, so the platform mask cannot clip it.
export function GET() {
  return brandIcon(512, { maskable: true });
}
