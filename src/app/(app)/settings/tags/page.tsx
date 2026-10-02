import type { Metadata } from "next";
import { SettingsSection } from "@/components/settings/settings-ui";
import { TagsManager } from "@/components/settings/tags-manager";
import { listTagsWithUsage } from "@/db/queries/tags";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Tags" };

export default async function TagsSettingsPage() {
  const user = await requireUser({ redirect: true });
  const tags = await listTagsWithUsage(user.id);

  return (
    <SettingsSection title="Tags">
      <p className="type-body-md text-muted-foreground">
        Tags apply to tasks and notes. Create them from the tag field on any task or note.
      </p>
      <TagsManager tags={tags} />
    </SettingsSection>
  );
}
