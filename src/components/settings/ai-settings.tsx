"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updatePreferences } from "@/actions/settings";
import { Switch } from "@/components/ui/switch";
import { SettingsRow } from "./settings-ui";

type Props = {
  initialEnabled: boolean;
  /** The floating chat button (feature 11 §6A). */
  initialLauncher: boolean;
  /** False when the server has a real provider selected but no key: AI is off for everyone. */
  available: boolean;
  provider: "anthropic" | "gemini" | "mock";
  /** AI actions used today (rate-limited attempts don't count) and the daily limit. */
  used: number;
  limit: number;
};

const PROVIDER_NAME = {
  anthropic: "Anthropic",
  gemini: "Google (Gemini)",
  mock: "a built-in test assistant",
} as const;

const POLICY_URL = {
  anthropic: "https://www.anthropic.com/legal/privacy",
  gemini: "https://ai.google.dev/gemini-api/terms",
} as const;

export function AiSettings({
  initialEnabled,
  initialLauncher,
  available,
  provider,
  used,
  limit,
}: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [launcher, setLauncher] = useState(initialLauncher);

  async function changeLauncher(next: boolean) {
    setLauncher(next);
    const result = await updatePreferences({ assistantLauncher: next });
    if (!result.ok) {
      setLauncher(!next);
      toast.error(result.error.message);
    }
  }

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

      {enabled && available ? (
        <SettingsRow
          title="Show the chat button"
          description="The round button at the bottom right of every screen. Off hides only the button: the Assistant page, ⌘K and Ask about this still work."
        >
          <Switch
            checked={launcher}
            onCheckedChange={changeLauncher}
            aria-label="Show the chat button"
          />
        </SettingsRow>
      ) : null}

      {available ? (
        <p className="mt-4 type-body-md text-foreground" data-testid="ai-usage">
          {used} of {limit} AI actions used today.{" "}
          <span className="text-muted-foreground">Resets at midnight.</span>
        </p>
      ) : (
        <p role="status" className="mt-4 type-body-md text-muted-foreground">
          AI isn’t set up on this server, so no AI buttons are shown. Everything else works as
          usual.
        </p>
      )}

      <section className="mt-6" aria-labelledby="ai-data-heading">
        <h3 id="ai-data-heading" className="type-label-caps text-muted-foreground">
          How your data is used
        </h3>
        <p className="mt-3 max-w-xl type-body-md text-foreground">
          AI actions run only when you ask for them. Each action sends the minimum relevant content
          to {PROVIDER_NAME[provider]}. Prompts and answers aren’t stored, except inbox suggestions
          and the daily suggestion. Nothing is created or changed until you confirm it. Deleted
          accounts may remain in backups until they rotate out.
        </p>
        <p className="mt-3 max-w-xl type-body-md text-foreground">
          Generating content also sends your prompt and, if you allow it, the note or task you’re
          working in. Planning sends the titles of your overdue and due tasks. Writing help sends
          only the text you select. Ask AI and Update with AI send the text you select and the text
          around it. The assistant sends your question, your recent messages and the notes, tasks
          and projects it looks at to answer; its conversations stay on this device and are removed
          when you sign out.
        </p>
        {provider === "gemini" ? (
          <p className="mt-3 max-w-xl type-body-md text-foreground">
            This server uses Google’s free Gemini tier. Google may use content sent on the free tier
            to improve its products, so avoid using AI actions on anything you wouldn’t want shared.
          </p>
        ) : null}
        {provider !== "mock" ? (
          <p className="mt-3 type-body-md">
            <a
              href={POLICY_URL[provider]}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              Read the provider’s data policy
            </a>
          </p>
        ) : null}
      </section>
    </>
  );
}
