"use server";

import { revalidatePath } from "next/cache";
import * as mutations from "@/db/mutations/canvases";
import {
  getCanvas,
  listLinkedTasks,
  getCardTarget,
  searchCanvasesToLink,
  searchTasksToLinkToCanvas,
} from "@/db/queries/canvases";
import { runAction, type ActionResult } from "@/lib/actions";
import type {
  CanvasSaveResult,
  CanvasTaskDTO,
  CardTargetDTO,
  LinkedCanvasDTO,
} from "@/lib/canvas/dto";
import type { Scene } from "@/lib/canvas/types";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import {
  addCardTargetSchema,
  archiveCanvasSchema,
  canvasIdSchema,
  createCanvasSchema,
  findLinkSchema,
  linkTaskCanvasSchema,
  saveCanvasSchema,
  updateCanvasMetaSchema,
} from "@/lib/validations/canvases";

// Server Actions of canvases (V3 feature 01 §6). Each starts with who is asking, checks its input with Zod, and writes
// only that person's rows. Autosave does not refresh the layout (nothing the sidebar shows changed); the rest do.

function refreshCanvases() {
  revalidatePath("/canvases", "layout");
  revalidatePath("/", "layout");
}

export async function createCanvas(
  input: unknown,
): Promise<ActionResult<{ id: string; version: number }>> {
  return runAction("canvases.create", async () => {
    const user = await requireUser();
    const parsed = createCanvasSchema.parse(input);
    // A diagram drawn by AI comes with its scene: counts with nothing to count are refused.
    if (parsed.proposal && parsed.scene === undefined) {
      throw new AppError("VALIDATION_ERROR", "That diagram couldn't be saved.");
    }
    const created = await mutations.createCanvas(user.id, parsed);
    refreshCanvases();
    return created;
  });
}

export async function saveCanvas(input: unknown): Promise<ActionResult<CanvasSaveResult>> {
  return runAction("canvases.save", async () => {
    const user = await requireUser();
    return mutations.saveCanvas(user.id, saveCanvasSchema.parse(input));
  });
}

/** The latest saved scene and version: "Load latest" after a conflict banner. */
export async function loadCanvas(
  input: unknown,
): Promise<ActionResult<{ version: number; scene: Scene; updatedAt: string }>> {
  return runAction("canvases.load", async () => {
    const user = await requireUser();
    const canvas = await getCanvas(user.id, canvasIdSchema.parse(input).id);
    if (!canvas) throw new AppError("NOT_FOUND");
    return { version: canvas.version, scene: canvas.scene, updatedAt: canvas.updatedAt };
  });
}

export async function updateCanvasMeta(input: unknown): Promise<ActionResult> {
  return runAction("canvases.updateMeta", async () => {
    const user = await requireUser();
    await mutations.updateCanvasMeta(user.id, updateCanvasMetaSchema.parse(input));
    refreshCanvases();
  });
}

export async function archiveCanvas(input: unknown): Promise<ActionResult> {
  return runAction("canvases.archive", async () => {
    const user = await requireUser();
    const { id, archived } = archiveCanvasSchema.parse(input);
    await mutations.archiveCanvas(user.id, id, archived);
    refreshCanvases();
  });
}

export async function deleteCanvas(input: unknown): Promise<ActionResult> {
  return runAction("canvases.delete", async () => {
    const user = await requireUser();
    await mutations.deleteCanvas(user.id, canvasIdSchema.parse(input).id);
    refreshCanvases();
    revalidatePath("/trash");
  });
}

export async function restoreCanvas(input: unknown): Promise<ActionResult> {
  return runAction("canvases.restore", async () => {
    const user = await requireUser();
    await mutations.restoreCanvas(user.id, canvasIdSchema.parse(input).id);
    refreshCanvases();
    revalidatePath("/trash");
  });
}

export async function permanentlyDeleteCanvas(input: unknown): Promise<ActionResult> {
  return runAction("canvases.permanentlyDelete", async () => {
    const user = await requireUser();
    await mutations.permanentlyDeleteCanvas(user.id, canvasIdSchema.parse(input).id);
    refreshCanvases();
    revalidatePath("/trash");
  });
}

/**
 * For a card: the title and in-app address of one of the person's own notes, tasks or projects. A task is also linked
 * to the canvas in the same step when `canvasId` is sent (dropping a task card links the task once).
 */
export async function addCardTarget(input: unknown): Promise<ActionResult<CardTargetDTO>> {
  return runAction("canvases.addCardTarget", async () => {
    const user = await requireUser();
    const { type, id, canvasId } = addCardTargetSchema.parse(input);
    const target = await getCardTarget(user.id, type, id);
    if (!target) throw new AppError("NOT_FOUND");
    if (type === "task" && canvasId) {
      await mutations.linkTaskCanvas(user.id, id, canvasId);
      revalidatePath("/", "layout");
    }
    return target;
  });
}

export async function linkTaskCanvas(input: unknown): Promise<ActionResult> {
  return runAction("canvases.link", async () => {
    const user = await requireUser();
    const { taskId, canvasId } = linkTaskCanvasSchema.parse(input);
    await mutations.linkTaskCanvas(user.id, taskId, canvasId);
    revalidatePath("/", "layout");
  });
}

export async function unlinkTaskCanvas(input: unknown): Promise<ActionResult> {
  return runAction("canvases.unlink", async () => {
    const user = await requireUser();
    const { taskId, canvasId } = linkTaskCanvasSchema.parse(input);
    await mutations.unlinkTaskCanvas(user.id, taskId, canvasId);
    revalidatePath("/", "layout");
  });
}

export async function findTasksToLinkToCanvas(
  input: unknown,
): Promise<ActionResult<CanvasTaskDTO[]>> {
  return runAction("canvases.findTasks", async () => {
    const user = await requireUser();
    return searchTasksToLinkToCanvas(user.id, findLinkSchema.parse(input).query);
  });
}

/** The tasks linked to a canvas, after a task card was dropped on it. */
export async function getLinkedTasks(input: unknown): Promise<ActionResult<CanvasTaskDTO[]>> {
  return runAction("canvases.linkedTasks", async () => {
    const user = await requireUser();
    return listLinkedTasks(user.id, canvasIdSchema.parse(input).id);
  });
}

export async function findCanvasesToLink(input: unknown): Promise<ActionResult<LinkedCanvasDTO[]>> {
  return runAction("canvases.findCanvases", async () => {
    const user = await requireUser();
    return searchCanvasesToLink(user.id, findLinkSchema.parse(input).query);
  });
}
