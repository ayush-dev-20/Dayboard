import { z } from "zod";
import { isValidDateString } from "@/lib/dates/calendar";
import { isSingleEmoji } from "@/lib/emoji";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/status";
import { defaultConfig } from "@/lib/views/defaults";
import { FILTER_BUCKETS } from "@/lib/views/due-buckets";
import {
  displayProperties,
  getProperty,
  isValidGroupBy,
  type PropertyDef,
} from "@/lib/views/properties";
import {
  COLLECTIONS,
  MAX_FILTERS,
  MAX_SORTS,
  UNAVAILABLE_VIEW_TYPES,
  VIEW_NAME_MAX,
  VIEW_TYPES,
  VIEW_TYPES_BY_COLLECTION,
  type Collection,
  type ViewConfig,
  type ViewFilter,
  type ViewType,
} from "@/lib/views/types";
import { idSchema } from "./tasks";

// One schema per action input (V2 feature 06 §6). `viewConfigSchema(collection)` is the one rule for
// what a saved view may hold: unknown properties, operators that do not fit the property, and more
// than 12 filters or 4 sorts are refused. Properties are the registry's, so the schema and the
// engine can never disagree.

export const collectionSchema = z.enum(COLLECTIONS);
export const viewTypeSchema = z.enum(VIEW_TYPES);

export const viewNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(VIEW_NAME_MAX, `Use ${VIEW_NAME_MAX} characters or fewer.`);
export const viewEmojiSchema = z.string().refine(isSingleEmoji, "Choose a single emoji.");

const dateValue = z
  .string()
  .refine((v) => v === "@today" || isValidDateString(v), "Choose a valid date.");

/** Whether `value` fits `op` on `property` (the engine's own reading of each filter). */
function valueProblem(property: PropertyDef, filter: ViewFilter): string | null {
  switch (filter.op) {
    case "isEmpty":
    case "isNotEmpty":
      return filter.value === undefined ? null : "This filter takes no value.";
    case "inBucket":
      return (FILTER_BUCKETS as readonly unknown[]).includes(filter.value)
        ? null
        : "Choose a due period.";
    case "between":
      return Array.isArray(filter.value) &&
        filter.value.length === 2 &&
        filter.value.every((v) => dateValue.safeParse(v).success)
        ? null
        : "Choose two dates.";
    default:
      break;
  }
  switch (property.type) {
    case "boolean":
      return typeof filter.value === "boolean" ? null : "Choose yes or no.";
    case "text":
      return typeof filter.value === "string" && filter.value.length <= 200 ? null : "Enter text.";
    case "number":
      return typeof filter.value === "number" && Number.isFinite(filter.value)
        ? null
        : "Enter a number.";
    case "date":
      return dateValue.safeParse(filter.value).success ? null : "Choose a date.";
    default: {
      const list = filter.op === "isAnyOf" || filter.op === "isNoneOf";
      const values = list ? filter.value : [filter.value];
      if (
        !Array.isArray(values) ||
        values.length > 50 ||
        !values.every((v) => typeof v === "string" && v.length <= 64)
      ) {
        return "Choose a value.";
      }
      const allowed =
        property.id === "status"
          ? (TASK_STATUSES as readonly string[])
          : property.id === "priority"
            ? (TASK_PRIORITIES as readonly string[])
            : null;
      if (allowed && !(values as string[]).every((v) => allowed.includes(v)))
        return "Choose a valid option.";
      if (
        (property.id === "project" || property.id === "tags") &&
        !(values as string[]).every((v) => idSchema.safeParse(v).success)
      ) {
        return "Choose a valid option.";
      }
      return null;
    }
  }
}

const filterShape = z.strictObject({
  property: z.string().max(40),
  op: z.string().max(20),
  value: z.unknown().optional(),
});

export function viewConfigSchema(collection: Collection) {
  const display = new Set(displayProperties(collection).map((p) => p.id));
  const propertyList = z.array(z.string()).max(20);

  return z
    .strictObject({
      filters: z.array(filterShape).max(MAX_FILTERS, `Use ${MAX_FILTERS} filters or fewer.`),
      sorts: z
        .array(z.strictObject({ property: z.string().max(40), dir: z.enum(["asc", "desc"]) }))
        .max(MAX_SORTS, `Use ${MAX_SORTS} sorts or fewer.`),
      groupBy: z.string().max(20).nullable(),
      hideEmptyGroups: z.boolean(),
      columnOrder: propertyList.optional(),
      visibleProperties: propertyList,
      columnWidths: z.record(z.string(), z.number().int().min(60).max(800)).optional(),
      boardColumnOrder: z
        .strictObject({
          project: z.array(idSchema).max(200).optional(),
          tag: z.array(idSchema).max(200).optional(),
        })
        .optional(),
      collapsedGroups: z.array(z.string().max(64)).max(50).optional(),
      cardSize: z.enum(["small", "medium", "large"]).optional(),
      calendar: z
        .strictObject({ mode: z.enum(["month", "week"]), showCompleted: z.boolean() })
        .optional(),
      openIn: z.enum(["panel", "page"]),
    })
    .superRefine((config, ctx) => {
      config.filters.forEach((filter, index) => {
        const property = getProperty(collection, filter.property);
        if (!property) {
          ctx.addIssue({
            code: "custom",
            path: ["filters", index, "property"],
            message: "That property isn't available here.",
          });
          return;
        }
        if (!(property.ops as readonly string[]).includes(filter.op)) {
          ctx.addIssue({
            code: "custom",
            path: ["filters", index, "op"],
            message: "That filter doesn't fit this property.",
          });
          return;
        }
        const problem = valueProblem(property, filter as ViewFilter);
        if (problem)
          ctx.addIssue({ code: "custom", path: ["filters", index, "value"], message: problem });
      });

      const seen = new Set<string>();
      config.sorts.forEach((sort, index) => {
        const property = getProperty(collection, sort.property);
        if (!property || !property.sortable) {
          ctx.addIssue({
            code: "custom",
            path: ["sorts", index, "property"],
            message: "You can't sort by that.",
          });
        } else if (seen.has(sort.property)) {
          ctx.addIssue({
            code: "custom",
            path: ["sorts", index, "property"],
            message: "Each property can be sorted once.",
          });
        }
        seen.add(sort.property);
      });

      if (config.groupBy !== null && !isValidGroupBy(collection, config.groupBy)) {
        ctx.addIssue({ code: "custom", path: ["groupBy"], message: "You can't group by that." });
      }
      for (const key of ["visibleProperties", "columnOrder"] as const) {
        (config[key] ?? []).forEach((id, index) => {
          if (!display.has(id)) {
            ctx.addIssue({
              code: "custom",
              path: [key, index],
              message: "That property isn't available here.",
            });
          }
        });
      }
      for (const id of Object.keys(config.columnWidths ?? {})) {
        if (!display.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["columnWidths", id],
            message: "That property isn't available here.",
          });
        }
      }
      if (collection === "NOTES" && config.openIn !== "page") {
        ctx.addIssue({ code: "custom", path: ["openIn"], message: "Notes open as a page." });
      }
    });
}

export function isViewTypeAllowed(collection: Collection, type: ViewType): boolean {
  return (
    VIEW_TYPES_BY_COLLECTION[collection].includes(type) && !UNAVAILABLE_VIEW_TYPES.includes(type)
  );
}

/**
 * A saved config read back for use: valid as it is, or replaced by the type's default with `reset`
 * set, so the person is told once ("This view's settings were reset") instead of seeing a broken page.
 */
export function readViewConfig(
  collection: Collection,
  type: ViewType,
  raw: unknown,
): { config: ViewConfig; reset: boolean } {
  const parsed = viewConfigSchema(collection).safeParse(raw);
  return parsed.success
    ? { config: parsed.data as ViewConfig, reset: false }
    : { config: defaultConfig(collection, type), reset: true };
}

const configInput = (collection: Collection) => viewConfigSchema(collection);

export const createViewSchema = z
  .strictObject({
    id: idSchema.optional(),
    collection: collectionSchema,
    name: viewNameSchema,
    emoji: viewEmojiSchema.nullish(),
    type: viewTypeSchema,
    config: z.unknown(),
    /** Insert after this view (by id); omitted means at the end. */
    afterId: idSchema.nullish(),
  })
  .superRefine((value, ctx) => {
    if (!isViewTypeAllowed(value.collection, value.type)) {
      ctx.addIssue({
        code: "custom",
        path: ["type"],
        message: "That view type isn't available for this collection.",
      });
    }
  })
  .transform((value, ctx) => {
    const parsed = configInput(value.collection).safeParse(value.config);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        ctx.addIssue({ ...issue, path: ["config", ...issue.path] });
      return z.NEVER;
    }
    return { ...value, config: parsed.data as ViewConfig };
  });

export const updateViewSchema = z.strictObject({
  id: idSchema,
  name: viewNameSchema.optional(),
  emoji: viewEmojiSchema.nullable().optional(),
  /** Validated against the view's collection by the mutation, which knows it. */
  config: z.unknown().optional(),
});

export const duplicateViewSchema = z.strictObject({ id: idSchema, newId: idSchema.optional() });
export const reorderViewSchema = z.strictObject({
  id: idSchema,
  beforeId: idSchema.nullish(),
  afterId: idSchema.nullish(),
});
export const viewIdSchema = z.strictObject({ id: idSchema });

export type CreateViewInput = z.output<typeof createViewSchema>;
export type UpdateViewInput = z.infer<typeof updateViewSchema>;
