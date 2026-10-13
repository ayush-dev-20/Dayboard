import type { Metadata } from "next";
import { AppInstallSection } from "@/components/settings/app-install-section";

export const metadata: Metadata = { title: "App" };

export default function AppSettingsPage() {
  return <AppInstallSection />;
}
