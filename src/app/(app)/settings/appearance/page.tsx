import type { Metadata } from "next";
import { SettingsSection } from "@/components/settings/settings-ui";
import { ThemeSetting } from "@/components/settings/theme-setting";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Appearance" };

export default async function AppearanceSettingsPage() {
  const user = await requireUser({ redirect: true });
  const { theme } = await getPreferences(user.id);

  return (
    <SettingsSection title="Appearance">
      <ThemeSetting initial={theme} />
    </SettingsSection>
  );
}
