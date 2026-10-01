"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updatePreferences } from "@/actions/settings";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "./settings-ui";

// Usage ("12 of 100 AI actions") and the provider name arrive with feature 05, which owns ai_usage.
export function AiSettings({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);

  async function change(next: boolean) {
    setEnabled(next);
    const result = await updatePreferences({ aiEnabled: next });
    if (!result.ok) {
      setEnabled(!next);
      toast.error(result.error.message);
    }
  }

  return (
    <>
      <SettingsRow
        title="Enable AI features"
        description="Off hides every AI button and answer. The rest of Dayboard is unchanged."
      >
        <Switch checked={enabled} onCheckedChange={change} aria-label="Enable AI features" />
      </SettingsRow>

      <section className="mt-6" aria-labelledby="ai-data-heading">
        <h3 id="ai-data-heading" className="type-label-caps text-muted-foreground">
          How your data is used
        </h3>
        <p className="mt-3 max-w-xl type-body-md text-foreground">
          AI actions run only when you ask for them. Each action sends the minimum relevant content
          to the AI provider. Prompts and answers aren’t stored, except inbox suggestions and the
          daily suggestion. Deleted accounts may remain in backups until they rotate out.
        </p>
      </section>
    </>
  );
}
