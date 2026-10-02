import type { Metadata } from "next";
import { AiSettings } from "@/components/settings/ai-settings";
import { SettingsSection } from "@/components/settings/settings-ui";
import { countToday, getLimits } from "@/lib/ai/usage";
import { env } from "@/lib/env";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "AI assistant" };

export default async function AiSettingsPage() {
  const user = await requireUser({ redirect: true });
  const { aiEnabled, timezone } = await getPreferences(user.id);
  const used = await countToday(user.id, timezone);

  return (
    <SettingsSection title="AI assistant">
      <AiSettings
        initialEnabled={aiEnabled}
        available={env.aiAvailable}
        provider={env.aiProvider}
        used={used}
        limit={getLimits().perDay}
      />
    </SettingsSection>
  );
}
