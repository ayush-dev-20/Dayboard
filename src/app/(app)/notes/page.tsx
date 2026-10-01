import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";

export const metadata: Metadata = { title: "Notes" };

export default function NotesPage() {
  return <ComingSoon title="Notes" />;
}
