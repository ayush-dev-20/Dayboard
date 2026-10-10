import "server-only";
import { z } from "zod";
import {
  buildProposal,
  findRelatedItems,
  listTasksFor,
  readItem,
  searchItems,
  type ItemType,
} from "@/db/queries/assistant";
import type { DayPrefs } from "@/lib/dates/today";
import { AppError } from "@/lib/errors";
import { idSchema, taskPrioritySchema, taskStatusSchema } from "@/lib/validations/tasks";
import { proposalBodySchema } from "@/lib/validations/assistant";
import { dataBlock } from "../prompts";
import type { AssistantTool, AssistantTools, ToolResult } from "../provider";
import type { Proposal } from "../assistant-types";
import { READ_CHARS, type RegisteredItem, type SourceRegistry } from "./registry";
import { reasonsFor } from "./reasons";
import { inScope, type Scope } from "./scope";

// The application commands the assistant may call (feature 11 §4). Each one has a Zod input schema
// and an owner-scoped implementation; none of them writes. `proposeTaskChanges` only records a
// proposal for the person to review. There is no tool that reaches the database in any other way.

export type ToolContext = {
  userId: string;
  prefs: DayPrefs;
  /** Set when the person pointed the assistant at items: every tool stays inside it. */
  scope: Scope | null;
  registry: SourceRegistry;
  /** Hands a proposal to the stream. Called at most `MAX_PROPOSALS` times per turn. */
  emitProposal(proposal: Proposal): void;
};

export const MAX_PROPOSALS = 3;
const NOT_AVAILABLE = "That item is not available.";
const FULL = "The limit of items for this answer was reached. Answer with what you already have.";

/** One item as the model reads it: a labelled data block, with the id it can use in a proposal. */
export function blockFor(item: RegisteredItem): string {
  return dataBlock(
    item.label,
    `Type: ${item.type}\nId: ${item.id}\nTitle: ${item.title}\n\n${item.body}`,
  );
}

function result(items: RegisteredItem[], emptyText: string, extra?: string): ToolResult {
  const text = items.length
    ? [...items.map(blockFor), ...(extra ? [extra] : [])].join("\n\n")
    : emptyText;
  return {
    text,
    items: items.map(({ label, type, id, title, body }) => ({ label, type, id, title, body })),
  };
}

const typeSchema = z.enum(["note", "task", "project"]);

export function createAssistantTools(ctx: ToolContext): AssistantTools {
  let proposals = 0;

  const searchWorkspace: AssistantTool = {
    description:
      "Search the person's notes, tasks and projects by words from their question. Returns up to 8 labelled items with short excerpts. Use it first for any question about what they wrote or planned.",
    inputSchema: z.object({
      query: z
        .string()
        .min(2)
        .max(200)
        .describe("Key words from the question, not a full sentence"),
      types: z.array(typeSchema).max(3).optional().describe("Limit to these kinds of item"),
    }),
    async execute(raw) {
      const input = z
        .object({ query: z.string(), types: z.array(typeSchema).optional() })
        .parse(raw);
      const { keywords, items } = await searchItems(ctx.userId, input.query, ctx.prefs, {
        types: input.types as ItemType[] | undefined,
        scope: ctx.scope,
      });
      const added: RegisteredItem[] = [];
      let full = false;
      for (const item of items) {
        const registered = ctx.registry.register({
          ...item,
          reasons: reasonsFor(keywords, item.title, item.body, "keyword"),
        });
        if (registered) added.push(registered);
        else full = true;
      }
      return result(added, "No items matched.", full ? FULL : undefined);
    },
  };

  const getItem: AssistantTool = {
    description:
      "Read one note, task or project in full, by the id you were given. Use it when an excerpt is not enough.",
    inputSchema: z.object({
      type: typeSchema,
      id: z.string().describe("The Id from an item you were given"),
    }),
    async execute(raw) {
      const input = z.object({ type: typeSchema, id: idSchema }).safeParse(raw);
      if (!input.success || !inScope(ctx.scope, input.data.type, input.data.id)) {
        return { text: NOT_AVAILABLE };
      }
      const item = await readItem(ctx.userId, input.data.type, input.data.id);
      if (!item) return { text: NOT_AVAILABLE };
      const registered = ctx.registry.register(
        {
          type: item.type,
          id: item.id,
          title: item.title,
          href: item.href,
          body: item.body,
          reasons: { via: ctx.scope ? "scope" : "opened", matchedTerms: [], passage: null },
        },
        READ_CHARS,
      );
      return registered ? result([registered], NOT_AVAILABLE) : { text: FULL };
    },
  };

  const listTasks: AssistantTool = {
    description:
      "List the person's open tasks: all of them, only the overdue ones, or only those due today, optionally in one project. Oldest due date first.",
    inputSchema: z.object({
      filter: z.enum(["open", "overdue", "dueToday"]),
      projectId: z
        .string()
        .optional()
        .describe("The Id of a project, if the question is about one"),
      limit: z.number().int().min(1).max(20).optional(),
    }),
    async execute(raw) {
      const input = z
        .object({
          filter: z.enum(["open", "overdue", "dueToday"]),
          projectId: idSchema.optional(),
          limit: z.number().int().min(1).max(20).optional(),
        })
        .safeParse(raw);
      if (!input.success) return { text: "That filter is not valid." };
      const rows = await listTasksFor(ctx.userId, ctx.prefs, {
        filter: input.data.filter,
        projectId: input.data.projectId,
        scope: ctx.scope,
        limit: input.data.limit ?? 10,
      });
      const added: RegisteredItem[] = [];
      let full = false;
      for (const row of rows) {
        const body = [
          `Status: ${row.status}`,
          `Priority: ${row.priority}`,
          `Due: ${row.dueDate ?? "none"}`,
          row.project ? `Project: ${row.project}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        const registered = ctx.registry.register({
          type: "task",
          id: row.id,
          title: row.title,
          href: `/tasks?task=${row.id}`,
          body,
          reasons: { via: "listed", matchedTerms: [], passage: null },
        });
        if (registered) added.push(registered);
        else full = true;
      }
      return result(added, "No tasks matched that filter.", full ? FULL : undefined);
    },
  };

  const findRelated: AssistantTool = {
    description:
      "Find notes and tasks that share words with one note or task, excluding what it is already linked to.",
    inputSchema: z.object({
      type: z.enum(["note", "task"]),
      id: z.string().describe("The Id of the note or task"),
    }),
    async execute(raw) {
      const input = z.object({ type: z.enum(["note", "task"]), id: idSchema }).safeParse(raw);
      if (!input.success || !inScope(ctx.scope, input.data.type, input.data.id)) {
        return { text: NOT_AVAILABLE };
      }
      const found = await findRelatedItems(ctx.userId, input.data.type, input.data.id, ctx.prefs, {
        scope: ctx.scope,
      });
      if (!found) return { text: NOT_AVAILABLE };
      const added: RegisteredItem[] = [];
      for (const item of found.related) {
        const registered = ctx.registry.register({
          type: item.type,
          id: item.id,
          title: item.title,
          href: item.href,
          body: item.body,
          reasons: { via: "related", matchedTerms: item.terms, passage: null },
        });
        if (registered) added.push(registered);
      }
      return result(added, "Nothing related was found.");
    },
  };

  const proposeTaskChanges: AssistantTool = {
    description:
      "Suggest changes for the person to review. This does NOT change anything: they decide. kind=createTasks needs items [{title, dueDate?, priority?, projectId?, linkNoteId?}]; kind=updateTasks needs changes [{taskId, set:{status?, priority?, dueDate?, projectId?}}]; kind=linkNotes needs links [{taskId, noteId}]. Use only ids you were given and only what the person asked for.",
    // A flat object, because some providers refuse a top-level union. The body is validated below.
    inputSchema: z.object({
      kind: z.enum(["createTasks", "updateTasks", "linkNotes"]),
      items: z
        .array(
          z.object({
            title: z.string(),
            dueDate: z.string().nullable().optional(),
            priority: taskPrioritySchema.optional(),
            projectId: z.string().nullable().optional(),
            linkNoteId: z.string().nullable().optional(),
          }),
        )
        .max(15)
        .optional(),
      changes: z
        .array(
          z.object({
            taskId: z.string(),
            set: z.object({
              status: taskStatusSchema.optional(),
              priority: taskPrioritySchema.optional(),
              dueDate: z.string().nullable().optional(),
              projectId: z.string().nullable().optional(),
            }),
          }),
        )
        .max(15)
        .optional(),
      links: z
        .array(z.object({ taskId: z.string(), noteId: z.string() }))
        .max(15)
        .optional(),
    }),
    async execute(raw) {
      if (proposals >= MAX_PROPOSALS) {
        return { text: "Enough suggestions for one answer. Tell the person what you suggested." };
      }
      const body = proposalBodySchema.safeParse(stripOtherKinds(raw));
      if (!body.success) {
        return {
          text: `That suggestion was not valid: ${body.error.issues[0]?.message ?? "wrong shape"}.`,
        };
      }
      // Inside a scope, a suggestion may only touch what the person pointed at.
      if (ctx.scope && !withinScope(ctx.scope, body.data)) {
        return {
          text: "That suggestion reaches outside the items the person pointed at. Leave it out.",
        };
      }
      try {
        const proposal = await buildProposal(ctx.userId, body.data);
        proposals += 1;
        ctx.emitProposal(proposal);
        return {
          text: "The suggestion was recorded. The person will review it and decide; nothing was changed. Say in one short sentence what you suggested, and do not say it was done.",
        };
      } catch (error) {
        if (error instanceof AppError && error.code === "VALIDATION_ERROR") {
          return {
            text: "One of the ids was not one of the person's items. Use only ids you were given.",
          };
        }
        throw error;
      }
    },
  };

  return { searchWorkspace, getItem, listTasks, findRelated, proposeTaskChanges };
}

/** Keeps only the list that belongs to `kind`, so a stray empty list from the model cannot fail validation. */
function stripOtherKinds(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const input = raw as Record<string, unknown>;
  const list =
    input.kind === "createTasks" ? "items" : input.kind === "updateTasks" ? "changes" : "links";
  return { kind: input.kind, [list]: input[list] };
}

function withinScope(scope: Scope, body: z.infer<typeof proposalBodySchema>): boolean {
  if (body.kind === "createTasks") {
    return body.items.every(
      (i) =>
        (!i.linkNoteId || scope.note.has(i.linkNoteId)) &&
        (!i.projectId || scope.project.has(i.projectId)),
    );
  }
  if (body.kind === "updateTasks") {
    return body.changes.every(
      (c) => scope.task.has(c.taskId) && (!c.set.projectId || scope.project.has(c.set.projectId)),
    );
  }
  return body.links.every((l) => scope.task.has(l.taskId) && scope.note.has(l.noteId));
}
