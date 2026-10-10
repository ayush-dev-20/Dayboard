"use server";

import { revalidatePath } from "next/cache";
import { applyProposal, type ApplyResult } from "@/db/mutations/assistant";
import {
  describeItems,
  findPickerItems,
  findRelatedItems,
  type ItemType,
} from "@/db/queries/assistant";
import { runAction, type ActionResult } from "@/lib/actions";
import { reasonsFor } from "@/lib/ai/assistant/reasons";
import { requireAIEnabled } from "@/lib/ai/gate";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";
import {
  applyProposalSchema,
  describeItemsSchema,
  findItemsSchema,
  relatedSchema,
} from "@/lib/validations/assistant";

// Server Actions of the workspace assistant (V2 feature 11). Each starts with who is asking and, for
// the AI ones, whether AI is on; each is scoped to that person.

/**
 * The person confirmed a proposal (feature 11 §5): the ticked, possibly edited rows come back, are
 * validated again here, and applied through the existing commands. Writes one audit row. This is
 * the only way the assistant's suggestions change anything.
 */
export async function applyAssistantProposal(input: unknown): Promise<ActionResult<ApplyResult>> {
  return runAction("assistant.apply", async () => {
    const user = await requireUser();
    const values = applyProposalSchema.parse(input);
    const { defaultTaskPriority } = await getPreferences(user.id);
    const result = await applyProposal(user.id, values, { priority: defaultTaskPriority });
    revalidatePath("/tasks", "layout");
    revalidatePath("/today");
    revalidatePath("/notes", "layout");
    return result;
  });
}

/** Titles for the items a drop or a menu names (the chips). Items that are not theirs are left out. */
export async function describeAssistantItems(
  input: unknown,
): Promise<ActionResult<{ type: ItemType; id: string; title: string }[]>> {
  return runAction("assistant.describe", async () => {
    const user = await requireUser();
    const { items } = describeItemsSchema.parse(input);
    return describeItems(user.id, items);
  });
}

/** The "Add item…" picker: the person's notes, tasks and projects by title. */
export async function findAssistantItems(
  input: unknown,
): Promise<ActionResult<{ type: ItemType; id: string; title: string }[]>> {
  return runAction("assistant.find", async () => {
    const user = await requireUser();
    const { query } = findItemsSchema.parse(input);
    return findPickerItems(user.id, query);
  });
}

export type RelatedDTO = {
  type: "note" | "task";
  id: string;
  title: string;
  href: string;
  /** One plain sentence built from the shared words (never from a model). */
  reason: string;
};

/**
 * The Related panel (feature 11 §6): up to five notes and tasks that share words with this one,
 * without a model call. Keyword-based until semantic search (feature 10) exists.
 */
export async function getRelatedItems(input: unknown): Promise<ActionResult<RelatedDTO[]>> {
  return runAction("assistant.related", async () => {
    const user = await requireUser();
    await requireAIEnabled(user);
    const { type, id } = relatedSchema.parse(input);
    const prefs = await getPreferences(user.id);
    const found = await findRelatedItems(
      user.id,
      type,
      id,
      { timezone: prefs.timezone, startOfDay: prefs.startOfDay.slice(0, 5) },
      { scope: null, limit: 5 },
    );
    if (!found) return [];
    return found.related.flatMap((r) => {
      if (r.type === "project") return [];
      const reasons = reasonsFor(r.terms, r.title, r.body, "related");
      const words = reasons.matchedTerms.slice(0, 3).map((w) => `“${w}”`);
      return [
        {
          type: r.type,
          id: r.id,
          title: r.title,
          href: r.href,
          reason: words.length ? `Mentions ${words.join(", ")}` : "Related by wording",
        },
      ];
    });
  });
}
