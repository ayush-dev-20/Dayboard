"use server";

import { revalidatePath } from "next/cache";
import * as mutations from "@/db/mutations/stickies";
import { getBoard } from "@/db/queries/stickies";
import { runAction, type ActionResult } from "@/lib/actions";
import type { BoardDTO, StickyDTO } from "@/lib/canvas/dto";
import { AppError } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { canvasIdSchema } from "@/lib/validations/canvases";
import {
  changeColumnStatusSchema,
  createStickySchema,
  deleteBoardColumnSchema,
  moveStickySchema,
  stickyIdSchema,
  updateStickySchema,
} from "@/lib/validations/stickies";

// Server Actions of sticky notes and board columns (V3 feature 01 §13.3). Each starts with who is asking, checks its
// input with Zod, and writes only that person's rows. A sticky note is a task, so a change here can change Today (the
// "Sticky notes" section); the board itself is client state, so a move does not refresh the layout.

function refreshToday() {
  revalidatePath("/today");
}

export async function createSticky(input: unknown): Promise<ActionResult<StickyDTO>> {
  return runAction("stickies.create", async () => {
    const user = await requireUser();
    const sticky = await mutations.createSticky(user.id, createStickySchema.parse(input));
    refreshToday();
    return sticky;
  });
}

export async function updateSticky(input: unknown): Promise<ActionResult<StickyDTO>> {
  return runAction("stickies.update", async () => {
    const user = await requireUser();
    const sticky = await mutations.updateSticky(user.id, updateStickySchema.parse(input));
    refreshToday();
    return sticky;
  });
}

export async function moveSticky(input: unknown): Promise<ActionResult<StickyDTO>> {
  return runAction("stickies.move", async () => {
    const user = await requireUser();
    const sticky = await mutations.moveSticky(user.id, moveStickySchema.parse(input));
    refreshToday();
    return sticky;
  });
}

export async function duplicateSticky(input: unknown): Promise<ActionResult<StickyDTO>> {
  return runAction("stickies.duplicate", async () => {
    const user = await requireUser();
    const sticky = await mutations.duplicateSticky(user.id, stickyIdSchema.parse(input).id);
    refreshToday();
    return sticky;
  });
}

export async function deleteSticky(input: unknown): Promise<ActionResult<{ deletedAt: string }>> {
  return runAction("stickies.delete", async () => {
    const user = await requireUser();
    const result = await mutations.deleteSticky(user.id, stickyIdSchema.parse(input).id);
    refreshToday();
    revalidatePath("/trash");
    return result;
  });
}

export async function restoreSticky(input: unknown): Promise<ActionResult<StickyDTO>> {
  return runAction("stickies.restore", async () => {
    const user = await requireUser();
    const sticky = await mutations.restoreSticky(user.id, stickyIdSchema.parse(input).id);
    refreshToday();
    revalidatePath("/trash");
    return sticky;
  });
}

export async function makeStickyRegularTask(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction("stickies.makeTask", async () => {
    const user = await requireUser();
    const result = await mutations.makeStickyRegularTask(user.id, stickyIdSchema.parse(input).id);
    revalidatePath("/tasks", "layout");
    refreshToday();
    return result;
  });
}

export async function changeColumnStatus(
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof mutations.changeColumnStatus>>>> {
  return runAction("stickies.changeColumnStatus", async () => {
    const user = await requireUser();
    const result = await mutations.changeColumnStatus(
      user.id,
      changeColumnStatusSchema.parse(input),
    );
    refreshToday();
    return result;
  });
}

export async function deleteBoardColumn(
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof mutations.deleteBoardColumn>>>> {
  return runAction("stickies.deleteColumn", async () => {
    const user = await requireUser();
    const result = await mutations.deleteBoardColumn(user.id, deleteBoardColumnSchema.parse(input));
    refreshToday();
    revalidatePath("/trash");
    return result;
  });
}

/** The latest columns, stickies and version: "Load latest" after a conflict banner, and the refresh after a column change. */
export async function loadBoard(input: unknown): Promise<ActionResult<BoardDTO>> {
  return runAction("stickies.loadBoard", async () => {
    const user = await requireUser();
    const board = await getBoard(user.id, canvasIdSchema.parse(input).id);
    if (!board) throw new AppError("NOT_FOUND");
    return board;
  });
}
