import { ProgressBar } from "@/components/projects/progress-bar";
import { formatBytes } from "@/lib/storage/policy";
import type { StorageUsage } from "@/lib/storage/dto";
import { SettingsRow } from "./settings-ui";

/** How much of the person's file allowance is used (V2 feature 09 §3.8). */
export function StorageSection({ usage }: { usage: StorageUsage }) {
  const percent =
    usage.quotaBytes > 0
      ? Math.min(100, Math.round((usage.usedBytes / usage.quotaBytes) * 100))
      : 0;
  return (
    <SettingsRow
      title="Files"
      description="Files you attach to notes, tasks and projects. Deleting a file frees its space."
      stackOnPhone
    >
      <div className="flex w-full min-w-56 flex-col gap-1.5 sm:w-64">
        <p className="type-body-sm text-foreground" data-testid="storage-usage">
          {formatBytes(usage.usedBytes)} of {formatBytes(usage.quotaBytes)} used
        </p>
        <ProgressBar percent={percent} showLabel={false} label="Storage used" />
      </div>
    </SettingsRow>
  );
}
