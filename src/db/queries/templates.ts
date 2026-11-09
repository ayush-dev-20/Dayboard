import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { templates, userPreferences, type Template } from "@/db/schema";
import { makeSnippet } from "@/lib/notes/dto";
import { isUsableTemplateDoc } from "@/lib/templates/schema";
import type { TemplateDTO, TemplateListItem } from "@/lib/templates/types";

// Reads of templates (V3 feature 03 §5). Every one is scoped to the signed-in person, and none ever reaches a note list,
// search, a count or the assistant: templates have their own table.

function toItem(row: Template, journalId: string | null): TemplateListItem {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    titlePattern: row.titlePattern,
    preview: makeSnippet(row.contentText),
    updatedAt: row.updatedAt.toISOString(),
    isJournal: row.id === journalId,
    starterKey: row.starterKey,
  };
}

async function journalTemplateId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: userPreferences.journalTemplateId })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row?.id ?? null;
}

/** The person's live templates, most recently changed first. */
export async function listTemplates(userId: string): Promise<TemplateListItem[]> {
  const [rows, journalId] = await Promise.all([
    db
      .select()
      .from(templates)
      .where(and(eq(templates.userId, userId), isNull(templates.deletedAt)))
      .orderBy(desc(templates.updatedAt)),
    journalTemplateId(userId),
  ]);
  return rows.map((row) => toItem(row, journalId));
}

/** One live template with its document, or null when it is not theirs or is in Trash. */
export async function getTemplate(userId: string, id: string): Promise<TemplateDTO | null> {
  const [row] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.id, id), eq(templates.userId, userId), isNull(templates.deletedAt)))
    .limit(1);
  if (!row) return null;
  const journalId = await journalTemplateId(userId);
  return { ...toItem(row, journalId), contentJson: row.contentJson, version: row.version };
}

/**
 * The template that starts new journal entries, or null: none chosen, it is in Trash, or it no longer passes the template
 * checks. A new entry then starts empty (the journal link degrades quietly).
 */
export async function getJournalTemplate(userId: string): Promise<TemplateDTO | null> {
  const id = await journalTemplateId(userId);
  if (!id) return null;
  const template = await getTemplate(userId, id);
  return template && isUsableTemplateDoc(template.contentJson) ? template : null;
}
