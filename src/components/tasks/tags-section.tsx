"use client";

import { setTaskTags } from "@/actions/tags";
import { Button } from "@/components/ui/button";
import { TagPicker } from "@/components/workspace/tag-picker";
import { TagBadge } from "@/components/workspace/tokens";
import type { TagDTO } from "@/lib/tags";

type Props = { taskId: string; tags: TagDTO[]; onChange: (tags: TagDTO[]) => void };

/** The task's tags as quiet chips, and "Add tag" to open the combobox (type to find, Enter to create). */
export function TagsSection({ taskId, tags, onChange }: Props) {
  return (
    <section aria-labelledby="task-tags-heading" className="mt-6">
      <h3 id="task-tags-heading" className="mb-2 type-label-caps text-muted-foreground">
        Tags
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((tag) => (
          <TagBadge key={tag.id} tag={tag} className="min-h-8 px-2.5" />
        ))}
        <TagPicker
          selected={tags}
          onChange={async (tagIds) => {
            const result = await setTaskTags({ id: taskId, tagIds });
            if (!result.ok) return null;
            onChange(result.data);
            return result.data;
          }}
        >
          <Button variant="secondary">{tags.length === 0 ? "Add tag" : "Edit tags"}</Button>
        </TagPicker>
      </div>
    </section>
  );
}
