import "server-only";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { inTransaction, type Executor, type Tx } from "@/db/executor";
import { assertOwnedProject } from "@/db/mutations/guards";
import { createNote } from "@/db/mutations/notes";
import { isUniqueViolation } from "@/db/mutations/reused-id";
import { templates, userPreferences } from "@/db/schema";
import type { DayPrefs } from "@/lib/dates/today";
import { getUserToday } from "@/lib/dates/today";
import { toPlainText } from "@/lib/editor/projection";
import type { TiptapDoc } from "@/lib/editor/types";
import { AppError } from "@/lib/errors";
import { applyPlaceholders, applyToTitle } from "@/lib/templates/placeholders";
import { isUsableTemplateDoc, sanitizeTemplateDoc } from "@/lib/templates/schema";
import { STARTERS, type StarterKey } from "@/lib/templates/starters";
import {
  DEFAULT_TEMPLATE_NAME,
  TEMPLATE_LIMIT,
  TEMPLATE_NAME_MAX,
  type TemplateSaveResult,
} from "@/lib/templates/types";

// Writes of templates (V3 feature 03 §5). Every function takes the signed-in person's id first and puts it in every WHERE
// clause: someone else's template behaves exactly like one that does not exist. A document is stored only after
// `sanitizeTemplateDoc`, and its plain-text copy is always built here, never taken from the client. A use of a template
// (`createNoteFromTemplate`) only reads it.

const EMPTY_DOC: TiptapDoc = { type: "doc", content: [] };
const textOf = (doc: TiptapDoc) => toPlainText(doc, () => undefined);

function owned(userId: string, id: string, includeDeleted = false) {
  return and(
    eq(templates.id, id),
    eq(templates.userId, userId),
    includeDeleted ? undefined : isNull(templates.deletedAt),
  );
}

async function assertUnderLimit(executor: Executor, userId: string, adding = 1) {
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(templates)
    .where(and(eq(templates.userId, userId), isNull(templates.deletedAt)));
  if ((row?.n ?? 0) + adding > TEMPLATE_LIMIT) {
    throw new AppError(
      "QUOTA_EXCEEDED",
      `You can keep ${TEMPLATE_LIMIT} templates. Delete one to make another.`,
    );
  }
}

export type CreateTemplateInput = {
  name?: string;
  emoji?: string | null;
  titlePattern?: string;
  contentJson?: TiptapDoc;
};

export async function createTemplate(
  userId: string,
  input: CreateTemplateInput,
  outer?: Tx,
): Promise<{ id: string; version: number }> {
  return inTransaction(outer, async (tx) => {
    await assertUnderLimit(tx, userId);
    const doc = input.contentJson ?? EMPTY_DOC;
    const [created] = await tx
      .insert(templates)
      .values({
        userId,
        name: input.name ?? DEFAULT_TEMPLATE_NAME,
        emoji: input.emoji ?? null,
        titlePattern: input.titlePattern ?? "",
        contentJson: doc,
        contentText: textOf(doc),
      })
      .returning({ id: templates.id, version: templates.version });
    if (!created) throw new AppError("INTERNAL_ERROR");
    return created;
  });
}

async function conflictOrMissing(
  executor: Executor,
  userId: string,
  id: string,
): Promise<TemplateSaveResult> {
  const [current] = await executor
    .select({ version: templates.version })
    .from(templates)
    .where(owned(userId, id))
    .limit(1);
  if (!current) throw new AppError("NOT_FOUND");
  return { outcome: "conflict", version: current.version };
}

/** Saves only if the template is still at the version the page started from. A stale save is `conflict`, as data. */
export async function saveTemplate(
  userId: string,
  input: {
    id: string;
    version: number;
    contentJson?: TiptapDoc;
    name?: string;
    titlePattern?: string;
  },
): Promise<TemplateSaveResult> {
  return db.transaction(async (tx) => {
    const patch: Partial<typeof templates.$inferInsert> = {
      version: sql`${templates.version} + 1` as never,
    };
    if (input.contentJson) {
      patch.contentJson = input.contentJson;
      patch.contentText = textOf(input.contentJson);
    }
    if (input.name !== undefined) patch.name = input.name;
    if (input.titlePattern !== undefined) patch.titlePattern = input.titlePattern;
    const [row] = await tx
      .update(templates)
      .set(patch)
      .where(and(owned(userId, input.id), eq(templates.version, input.version)))
      .returning({ version: templates.version, updatedAt: templates.updatedAt });
    if (!row) return conflictOrMissing(tx, userId, input.id);
    return { outcome: "saved", version: row.version, updatedAt: row.updatedAt.toISOString() };
  });
}

/** Name and emoji. Does not touch `version`, like a note's emoji. */
export async function updateTemplateMeta(
  userId: string,
  input: { id: string; name?: string; emoji?: string | null },
): Promise<void> {
  const patch: Partial<typeof templates.$inferInsert> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.emoji !== undefined) patch.emoji = input.emoji;
  if (Object.keys(patch).length === 0) {
    const [row] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(owned(userId, input.id))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND");
    return;
  }
  const [row] = await db
    .update(templates)
    .set(patch)
    .where(owned(userId, input.id))
    .returning({ id: templates.id });
  if (!row) throw new AppError("NOT_FOUND");
}

/** A copy named "<name> copy" (cut to the name limit). It is never a starter copy. */
export async function duplicateTemplate(
  userId: string,
  id: string,
): Promise<{ id: string; version: number }> {
  return db.transaction(async (tx) => {
    const [source] = await tx.select().from(templates).where(owned(userId, id)).limit(1);
    if (!source) throw new AppError("NOT_FOUND");
    await assertUnderLimit(tx, userId);
    const name = `${source.name} copy`.slice(0, TEMPLATE_NAME_MAX);
    const [created] = await tx
      .insert(templates)
      .values({
        userId,
        name,
        emoji: source.emoji,
        titlePattern: source.titlePattern,
        contentJson: source.contentJson,
        contentText: source.contentText,
      })
      .returning({ id: templates.id, version: templates.version });
    if (!created) throw new AppError("INTERNAL_ERROR");
    return created;
  });
}

/** To Trash. If it was the journal template, the choice is cleared too: restoring does not set it again. */
export async function deleteTemplate(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(templates)
      .set({ deletedAt: new Date() })
      .where(owned(userId, id))
      .returning({ id: templates.id });
    if (!row) throw new AppError("NOT_FOUND");
    await tx
      .update(userPreferences)
      .set({ journalTemplateId: null })
      .where(and(eq(userPreferences.userId, userId), eq(userPreferences.journalTemplateId, id)));
  });
}

export const STARTER_TAKEN =
  "You already have that starter template. Delete it first, or keep this one in Trash.";

export async function restoreTemplate(userId: string, id: string): Promise<void> {
  try {
    const [row] = await db
      .update(templates)
      .set({ deletedAt: null })
      .where(and(owned(userId, id, true), isNotNull(templates.deletedAt)))
      .returning({ id: templates.id });
    if (!row) throw new AppError("NOT_FOUND");
  } catch (error) {
    // A starter's copy comes back only while no live copy of that starter exists.
    if (isUniqueViolation(error)) throw new AppError("CONFLICT", STARTER_TAKEN);
    throw error;
  }
}

export async function permanentlyDeleteTemplate(userId: string, id: string): Promise<void> {
  const removed = await db
    .delete(templates)
    .where(and(owned(userId, id, true), isNotNull(templates.deletedAt)))
    .returning({ id: templates.id });
  if (removed.length === 0) throw new AppError("NOT_FOUND");
}

/** Sets or clears the template that starts new journal entries. It must be the person's own and live. */
export async function setJournalTemplate(userId: string, templateId: string | null): Promise<void> {
  if (templateId) {
    const [row] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(owned(userId, templateId))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND");
  }
  const updated = await db
    .update(userPreferences)
    .set({ journalTemplateId: templateId })
    .where(eq(userPreferences.userId, userId))
    .returning({ id: userPreferences.userId });
  if (updated.length === 0) {
    await db
      .insert(userPreferences)
      .values({ userId, journalTemplateId: templateId })
      .onConflictDoNothing();
    await db
      .update(userPreferences)
      .set({ journalTemplateId: templateId })
      .where(eq(userPreferences.userId, userId));
  }
}

/** Adds copies of the chosen starters, skipping any the person already has live. Never overwrites an edited copy. */
export async function addStarterTemplates(
  userId: string,
  keys: readonly StarterKey[],
): Promise<{ added: StarterKey[]; skipped: StarterKey[] }> {
  return db.transaction(async (tx) => {
    const unique = [...new Set(keys)];
    const have = await tx
      .select({ key: templates.starterKey })
      .from(templates)
      .where(
        and(
          eq(templates.userId, userId),
          isNull(templates.deletedAt),
          inArray(templates.starterKey, unique),
        ),
      );
    const haveKeys = new Set(have.map((h) => h.key));
    const skipped = unique.filter((k) => haveKeys.has(k));
    const toAdd = unique.filter((k) => !haveKeys.has(k));
    if (toAdd.length > 0) await assertUnderLimit(tx, userId, toAdd.length);
    const added: StarterKey[] = [];
    for (const key of toAdd) {
      const starter = STARTERS[key];
      const content = sanitizeTemplateDoc(starter.content);
      const inserted = await tx
        .insert(templates)
        .values({
          userId,
          name: starter.name,
          emoji: starter.emoji,
          titlePattern: starter.titlePattern,
          contentJson: content,
          contentText: textOf(content),
          starterKey: key,
        })
        .onConflictDoNothing()
        .returning({ id: templates.id });
      if (inserted[0]) added.push(key);
      else skipped.push(key);
    }
    return { added, skipped };
  });
}

/**
 * Makes a note now from a template: the title from the pattern and the text with its placeholders filled in, once, as plain
 * text. The template itself is not changed. A template in Trash, someone else's, or one that no longer passes the template
 * checks (it was saved under older rules) cannot be used.
 */
export async function createNoteFromTemplate(
  userId: string,
  input: { templateId: string; projectId?: string | null },
  prefs: DayPrefs,
  now: Date = new Date(),
): Promise<{ id: string; version: number }> {
  const [template] = await db
    .select()
    .from(templates)
    .where(owned(userId, input.templateId))
    .limit(1);
  if (!template) throw new AppError("NOT_FOUND");
  if (!isUsableTemplateDoc(template.contentJson)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "This template can't be used until it is edited and saved again.",
    );
  }
  if (input.projectId) await assertOwnedProject(db, userId, input.projectId);

  const day = getUserToday(prefs, now);
  const base = { day, now, timezone: prefs.timezone };
  const title = applyToTitle(template.titlePattern, { ...base, title: "" });
  const contentJson = applyPlaceholders(template.contentJson, { ...base, title });
  return createNote(userId, {
    title,
    emoji: template.emoji,
    projectId: input.projectId ?? null,
    contentJson,
  });
}
