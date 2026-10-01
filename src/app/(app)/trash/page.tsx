import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Trash" };

export default function TrashPage() {
  return <ComingSoon title="Trash" />;
}
