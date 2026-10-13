"use client";

import { Button } from "@/components/ui/button";
import { promptInstall } from "@/lib/pwa/install-prompt";
import { useInstall } from "@/components/pwa/use-install";
import { SettingsRow, SettingsSection } from "./settings-ui";

/** Install state and the way to install it on this browser (V2 feature 03 §5). */
export function AppInstallSection() {
  const view = useInstall();

  return (
    <SettingsSection title="App">
      <SettingsRow
        title="Install Dayboard"
        description={
          view === "installed"
            ? "Installed on this device."
            : view === "installable"
              ? "Open Dayboard in its own window, from your home screen or dock."
              : view === "ios"
                ? "Safari can add Dayboard to your home screen."
                : view === "menu"
                  ? "Your browser can install Dayboard from its menu."
                  : "Your browser can't install apps, but Dayboard works in the browser."
        }
        stackOnPhone
      >
        {view === "installable" ? (
          <Button onClick={() => void promptInstall()}>Install Dayboard</Button>
        ) : null}
      </SettingsRow>
      {view === "ios" ? (
        <ol className="list-decimal space-y-1 pt-3 pl-5 type-body-md text-foreground">
          <li>Tap the Share button in Safari.</li>
          <li>Choose Add to Home Screen, then Add.</li>
        </ol>
      ) : null}
    </SettingsSection>
  );
}
