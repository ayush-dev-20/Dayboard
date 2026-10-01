import type { Metadata } from "next";
import { AiSettings } from "@/components/settings/ai-settings";
import { SettingsSection } from "@/components/settings/settings-ui";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "AI assistant" };

export default async function AiSettingsPage() {
  const user = await requireUser({ redirect: true });
  const { aiEnabled } = await getPreferences(user.id);

  return (
    <SettingsSection title="AI assistant">
      <AiSettings initialEnabled={aiEnabled} />
    </SettingsSection>
  );
}
