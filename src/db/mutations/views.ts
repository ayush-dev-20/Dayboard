import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { inTransaction, type Executor, type Tx } from "@/db/executor";
import { collectionViews, projects, tags, type CollectionView } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { orderBetween, renumber, ORDER_STEP } from "@/lib/tasks/ordering";
import { defaultConfig, defaultViewSet } from "@/lib/views/defaults";
import {
  MAX_VIEWS_PER_COLLECTION,
  type Collection,
  type ViewConfig,
  type ViewDTO,
} from "@/lib/views/types";
import {
  readViewConfig,
  viewConfigSchema,
  type CreateViewInput,
  type UpdateViewInput,
} from "@/lib/validations/views";

// Saved views (V2 feature 06 §6). Every function takes the signed-in person's id first and puts it
// in every WHERE clause; someone else's view behaves exactly like one that doesn't exist. A
// collection always keeps at least one live view.

const liveOf = (userId: string, collection?: Collection) =>
  and(
    eq(collectionViews.userId, userId),
    isNull(collectionViews.deletedAt),
    collection ? eq(collectionViews.collection, collection) : undefined,
  );

function ownedView(userId: string, id: string, includeDeleted = false) {
  return and(
    eq(collectionViews.id, id),
    eq(collectionViews.userId, userId),
    includeDeleted ? undefined : isNull(collectionViews.deletedAt),
  );
}

export function toViewDTO(row: CollectionView): ViewDTO {
  const read = readViewConfig(row.collection, row.type, row.config);
  return {
    id: row.id,
    collection: row.collection,
    name: row.name,
    emoji: row.emoji,
    type: row.type,
    position: row.position,
    // A config that no longer passes the rules is replaced by the type's default (feature doc §6).
    config: read.config,
    ...(read.reset ? { configReset: true } : {}),
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadOwned(executor: Executor, userId: string, id: string, includeDeleted = false) {
  const [row] = await executor
    .select()
    .from(collectionViews)
    .where(ownedView(userId, id, includeDeleted))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/**
 * Project and tag filters may only name the person's own ids (a deleted project is still theirs, and
 * simply matches nothing).
 */
async function assertOwnedReferences(executor: Executor, userId: string, config: ViewConfig) {
  const projectIds = new Set<string>();
  const tagIds = new Set<string>();
  for (const filter of config.filters) {
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    const bucket =
      filter.property === "project" ? projectIds : filter.property === "tags" ? tagIds : null;
    if (bucket) for (const v of values) if (typeof v === "string") bucket.add(v);
  }
  for (const id of config.boardColumnOrder?.project ?? []) projectIds.add(id);
  for (const id of config.boardColumnOrder?.tag ?? []) tagIds.add(id);

  if (projectIds.size > 0) {
    const rows = await executor
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, userId), inArray(projects.id, [...projectIds])));
    if (rows.length !== projectIds.size) throw new AppError("NOT_FOUND");
  }
  if (tagIds.size > 0) {
    const rows = await executor
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.userId, userId), inArray(tags.id, [...tagIds])));
    if (rows.length !== tagIds.size) throw new AppError("NOT_FOUND");
  }
}

/** The person's live views of a collection, in tab order. */
export async function listViews(
  userId: string,
  collection: Collection,
  executor: Executor = db,
): Promise<ViewDTO[]> {
  const rows = await executor
    .select()
    .from(collectionViews)
    .where(liveOf(userId, collection))
    .orderBy(asc(collectionViews.position), asc(collectionViews.createdAt));
  return rows.map(toViewDTO);
}

/**
 * Gives a collection its default List view when it has none (an account made before views existed,
 * or whose views were all removed by hand). Idempotent and safe to call on every read.
 */
export async function ensureDefaultViews(userId: string, executor: Executor = db): Promise<void> {
  for (const spec of defaultViewSet()) {
    const [existing] = await executor
      .select({ id: collectionViews.id })
      .from(collectionViews)
      .where(liveOf(userId, spec.collection))
      .limit(1);
    if (!existing) {
      await executor.insert(collectionViews).values({
        userId,
        collection: spec.collection,
        name: spec.name,
        type: spec.type,
        position: ORDER_STEP,
        config: spec.config,
      });
    }
  }
}

async function positionAfter(
  tx: Executor,
  userId: string,
  collection: Collection,
  afterId: string | null | undefined,
): Promise<number> {
  const live = await tx
    .select({ id: collectionViews.id, position: collectionViews.position })
    .from(collectionViews)
    .where(liveOf(userId, collection))
    .orderBy(asc(collectionViews.position));
  const last = live.at(-1);
  if (!afterId) return last ? last.position + ORDER_STEP : ORDER_STEP;
  const index = live.findIndex((v) => v.id === afterId);
  if (index < 0) return last ? last.position + ORDER_STEP : ORDER_STEP;
  const above = live[index]!.position;
  const below = live[index + 1]?.position ?? null;
  return orderBetween(above, below).order;
}

export async function createView(
  userId: string,
  input: CreateViewInput,
  outer?: Tx,
): Promise<ViewDTO> {
  return inTransaction(outer, async (tx) => {
    const count = await tx
      .select({ id: collectionViews.id })
      .from(collectionViews)
      .where(liveOf(userId, input.collection));
    if (count.length >= MAX_VIEWS_PER_COLLECTION) {
      throw new AppError("VALIDATION_ERROR", `Use ${MAX_VIEWS_PER_COLLECTION} views or fewer.`);
    }
    await assertOwnedReferences(tx, userId, input.config);
    const position = await positionAfter(tx, userId, input.collection, input.afterId);

    const [created] = await tx
      .insert(collectionViews)
      .values({
        ...(input.id ? { id: input.id } : {}),
        userId,
        collection: input.collection,
        name: input.name,
        emoji: input.emoji ?? null,
        type: input.type,
        position,
        config: input.config,
      })
      .returning();
    if (!created) throw new AppError("INTERNAL_ERROR");
    return toViewDTO(created);
  });
}

export async function updateView(userId: string, input: UpdateViewInput): Promise<ViewDTO> {
  return db.transaction(async (tx) => {
    const view = await loadOwned(tx, userId, input.id);
    const patch: Partial<typeof collectionViews.$inferInsert> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.emoji !== undefined) patch.emoji = input.emoji;
    if (input.config !== undefined) {
      const parsed = viewConfigSchema(view.collection).safeParse(input.config);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new AppError(
          "VALIDATION_ERROR",
          issue?.message ?? "Those view settings aren't valid.",
        );
      }
      await assertOwnedReferences(tx, userId, parsed.data as ViewConfig);
      patch.config = parsed.data as ViewConfig;
    }
    if (Object.keys(patch).length === 0) return toViewDTO(view);

    const [updated] = await tx
      .update(collectionViews)
      .set({ ...patch, version: sql`${collectionViews.version} + 1` })
      .where(ownedView(userId, input.id))
      .returning();
    if (!updated) throw new AppError("NOT_FOUND");
    return toViewDTO(updated);
  });
}

export async function duplicateView(
  userId: string,
  input: { id: string; newId?: string },
): Promise<ViewDTO> {
  return db.transaction(async (tx) => {
    const source = await loadOwned(tx, userId, input.id);
    const name = `${source.name} copy`.slice(0, 60);
    return createView(
      userId,
      {
        ...(input.newId ? { id: input.newId } : {}),
        collection: source.collection,
        name,
        emoji: source.emoji,
        type: source.type,
        config: readViewConfig(source.collection, source.type, source.config).config,
        afterId: source.id,
      },
      tx,
    );
  });
}

/** `beforeId` is the tab that will sit just before the moved one, `afterId` just after. */
export async function reorderView(
  userId: string,
  input: { id: string; beforeId?: string | null; afterId?: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    const view = await loadOwned(tx, userId, input.id);
    const siblings = await tx
      .select({ id: collectionViews.id, position: collectionViews.position })
      .from(collectionViews)
      .where(liveOf(userId, view.collection))
      .orderBy(asc(collectionViews.position), asc(collectionViews.createdAt));

    const find = (id: string | null | undefined) => {
      if (!id) return null;
      if (id === input.id)
        throw new AppError("VALIDATION_ERROR", "A view can't go next to itself.");
      const row = siblings.find((s) => s.id === id);
      if (!row) throw new AppError("NOT_FOUND");
      return row;
    };
    const above = find(input.beforeId);
    const below = find(input.afterId);
    const { order, needsRenumber } = orderBetween(above?.position ?? null, below?.position ?? null);

    if (!needsRenumber) {
      await tx
        .update(collectionViews)
        .set({ position: order, version: sql`${collectionViews.version} + 1` })
        .where(ownedView(userId, input.id));
      return;
    }
    const ids = siblings.filter((s) => s.id !== input.id).map((s) => s.id);
    const at = above ? ids.indexOf(above.id) + 1 : below ? ids.indexOf(below.id) : ids.length;
    ids.splice(at, 0, input.id);
    for (const [id, position] of renumber(ids)) {
      await tx
        .update(collectionViews)
        .set({ position, version: sql`${collectionViews.version} + 1` })
        .where(ownedView(userId, id));
    }
  });
}

/** Soft delete. The last live view of a collection cannot be deleted. */
export async function deleteView(userId: string, id: string): Promise<{ deletedAt: string }> {
  return db.transaction(async (tx) => {
    const view = await loadOwned(tx, userId, id);
    const live = await tx
      .select({ id: collectionViews.id })
      .from(collectionViews)
      .where(liveOf(userId, view.collection));
    if (live.length <= 1) {
      throw new AppError("VALIDATION_ERROR", "A collection needs at least one view.");
    }
    const [updated] = await tx
      .update(collectionViews)
      .set({ deletedAt: new Date(), version: sql`${collectionViews.version} + 1` })
      .where(ownedView(userId, id))
      .returning({ deletedAt: collectionViews.deletedAt });
    if (!updated?.deletedAt) throw new AppError("NOT_FOUND");
    return { deletedAt: updated.deletedAt.toISOString() };
  });
}

export async function restoreView(userId: string, id: string): Promise<ViewDTO> {
  return db.transaction(async (tx) => {
    const view = await loadOwned(tx, userId, id, true);
    const [updated] = await tx
      .update(collectionViews)
      .set({ deletedAt: null, version: sql`${collectionViews.version} + 1` })
      .where(ownedView(userId, view.id, true))
      .returning();
    if (!updated) throw new AppError("NOT_FOUND");
    return toViewDTO(updated);
  });
}

/** The first Gallery view of the notes collection, created when there is none (legacy `?view=grid`). */
export async function ensureGalleryView(userId: string): Promise<ViewDTO> {
  return db.transaction(async (tx) => {
    // A collection with no views yet gets its List first, so the Gallery is never the only one.
    await ensureDefaultViews(userId, tx);
    const views = await listViews(userId, "NOTES", tx);
    const gallery = views.find((v) => v.type === "GALLERY");
    if (gallery) return gallery;
    return createView(
      userId,
      {
        collection: "NOTES",
        name: "Gallery",
        type: "GALLERY",
        config: defaultConfig("NOTES", "GALLERY"),
      },
      tx,
    );
  });
}
