"use server";

import { revalidatePath } from "next/cache";
import * as mutations from "@/db/mutations/templates";
import { listTemplates } from "@/db/queries/templates";
import { runAction, type ActionResult } from "@/lib/actions";
import { getDayPrefs } from "@/lib/preferences";
import { requireUser } from "@/lib/session";
import type { StarterKey } from "@/lib/templates/starters";
import type { TemplateListItem, TemplateSaveResult } from "@/lib/templates/types";
import {
  addStarterTemplatesSchema,
  createNoteFromTemplateSchema,
  createTemplateSchema,
  saveTemplateSchema,
  setJournalTemplateSchema,
  templateIdSchema,
  updateTemplateMetaSchema,
} from "@/lib/validations/templates";

// Server Actions of templates (V3 feature 03 §5). Each starts with who is asking, checks its input with Zod and writes
// only that person's rows. Autosave does not refresh the layout; the rest refresh the Templates page.

function refresh() {
  revalidatePath("/templates", "layout");
}

export async function createTemplate(
  input: unknown,
): Promise<ActionResult<{ id: string; version: number }>> {
  return runAction("templates.create", async () => {
    const user = await requireUser();
    const created = await mutations.createTemplate(user.id, createTemplateSchema.parse(input));
    refresh();
    return created;
  });
}

export async function saveTemplate(input: unknown): Promise<ActionResult<TemplateSaveResult>> {
  return runAction("templates.save", async () => {
    const user = await requireUser();
    return mutations.saveTemplate(user.id, saveTemplateSchema.parse(input));
  });
}

export async function updateTemplateMeta(input: unknown): Promise<ActionResult> {
  return runAction("templates.updateMeta", async () => {
    const user = await requireUser();
    await mutations.updateTemplateMeta(user.id, updateTemplateMetaSchema.parse(input));
    refresh();
  });
}

export async function duplicateTemplate(
  input: unknown,
): Promise<ActionResult<{ id: string; version: number }>> {
  return runAction("templates.duplicate", async () => {
    const user = await requireUser();
    const { id } = templateIdSchema.parse(input);
    const copy = await mutations.duplicateTemplate(user.id, id);
    refresh();
    return copy;
  });
}

export async function deleteTemplate(input: unknown): Promise<ActionResult> {
  return runAction("templates.delete", async () => {
    const user = await requireUser();
    await mutations.deleteTemplate(user.id, templateIdSchema.parse(input).id);
    refresh();
    revalidatePath("/trash");
  });
}

export async function restoreTemplate(input: unknown): Promise<ActionResult> {
  return runAction("templates.restore", async () => {
    const user = await requireUser();
    await mutations.restoreTemplate(user.id, templateIdSchema.parse(input).id);
    refresh();
    revalidatePath("/trash");
  });
}

export async function permanentlyDeleteTemplate(input: unknown): Promise<ActionResult> {
  return runAction("templates.permanentlyDelete", async () => {
    const user = await requireUser();
    await mutations.permanentlyDeleteTemplate(user.id, templateIdSchema.parse(input).id);
    revalidatePath("/trash");
  });
}

/** Makes the note now: an explicit choice, unlike `/notes/new`, which waits for the first keystroke. */
export async function createNoteFromTemplate(
  input: unknown,
): Promise<ActionResult<{ id: string; version: number }>> {
  return runAction("templates.createNote", async () => {
    const user = await requireUser();
    const parsed = createNoteFromTemplateSchema.parse(input);
    return mutations.createNoteFromTemplate(user.id, parsed, await getDayPrefs(user.id));
  });
}

export async function setJournalTemplate(input: unknown): Promise<ActionResult> {
  return runAction("templates.setJournal", async () => {
    const user = await requireUser();
    await mutations.setJournalTemplate(user.id, setJournalTemplateSchema.parse(input).templateId);
    refresh();
  });
}

export async function addStarterTemplates(
  input: unknown,
): Promise<ActionResult<{ added: StarterKey[]; skipped: StarterKey[] }>> {
  return runAction("templates.addStarters", async () => {
    const user = await requireUser();
    const result = await mutations.addStarterTemplates(
      user.id,
      addStarterTemplatesSchema.parse(input).keys,
    );
    refresh();
    return result;
  });
}

/** The person's templates for the picker (New note from template). */
export async function listTemplatePicks(): Promise<ActionResult<TemplateListItem[]>> {
  return runAction("templates.picks", async () => {
    const user = await requireUser();
    return listTemplates(user.id);
  });
}
