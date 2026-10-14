"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updatePreferences } from "@/actions/settings";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "./settings-ui";

type Props = {
  initialEnabled: boolean;
  /** Whether the person's AI features are on. Voice capture needs them. */
  aiEnabled: boolean;
  providerName: string;
  /** The Google free tier may use what is sent to improve its products (feature 13 §7). */
  freeTier: boolean;
};

/** The switch for voice capture and what happens to a recording (V2 feature 13 §7). */
export function VoiceSettings({ initialEnabled, aiEnabled, providerName, freeTier }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);

  async function change(next: boolean) {
    setEnabled(next);
    const result = await updatePreferences({ voiceCaptureEnabled: next });
    if (!result.ok) {
      setEnabled(!next);
      toast.error(result.error.message);
    }
  }

  return (
    <section className="mt-6" aria-labelledby="voice-heading">
      <h3 id="voice-heading" className="type-label-caps text-muted-foreground">
        Voice capture
      </h3>
      <SettingsRow
        title="Voice capture"
        description="Adds a microphone to quick capture and the Inbox. You record, check what was heard, and choose what to create: nothing is added until you confirm."
      >
        <Switch
          checked={enabled && aiEnabled}
          disabled={!aiEnabled}
          onCheckedChange={change}
          aria-label="Voice capture"
        />
      </SettingsRow>
      <p className="mt-3 max-w-xl type-body-md text-foreground">
        Recordings are sent to {providerName} to be transcribed. A recording is deleted when you
        finish reviewing it, unless you choose to keep it, and in any case within a day. The text is
        deleted when you create from it or discard it, and after seven days at most.
      </p>
      {freeTier ? (
        <p className="mt-3 max-w-xl type-body-md text-foreground">
          This server uses Google’s free Gemini tier. Google may use content sent on the free tier
          to improve its products, so avoid recording anything you wouldn’t want shared.
        </p>
      ) : null}
    </section>
  );
}
