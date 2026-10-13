import { z } from "zod";
import {
  clientIdSchema,
  completeTaskSchema,
  createTaskSchema,
  idSchema,
  updateTaskSchema,
} from "@/lib/validations/tasks";

// The operation a device pushes (V2 feature 05 §3). Shared by the push route and its tests. Payloads
// are checked per type with the same Zod schemas the online Server Actions use.

export const OPERATION_TYPES = [
  "task.create",
  "task.update",
  "task.complete",
  "task.reopen",
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

export const MAX_OPS_PER_PUSH = 50;
export const MAX_PUSH_BYTES = 1024 * 1024;
export const MAX_PULL_PAGE = 500;
/** Changes are read again this many log positions behind the cursor (see the overlap in ADR 0007). */
export const PULL_OVERLAP = 200;

/** The envelope. The payload is checked later, one operation at a time, so one bad payload is refused alone. */
export const opEnvelopeSchema = z.object({
  opId: clientIdSchema,
  entityType: z.literal("task"),
  entityId: idSchema,
  type: z.enum(OPERATION_TYPES),
  clientTimestamp: z.string().max(40),
  baseVersion: z.number().int().min(1).nullable(),
  payload: z.unknown(),
  dependsOn: z
    .array(z.strictObject({ entityType: z.literal("task"), entityId: idSchema }))
    .max(10)
    .optional(),
});
export type OpEnvelope = z.infer<typeof opEnvelopeSchema>;

export const pushRequestSchema = z.strictObject({
  deviceId: idSchema,
  appVersion: z.string().max(40),
  ops: z.array(opEnvelopeSchema).min(1).max(MAX_OPS_PER_PUSH),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;

/** The result the client gets for each operation. The last three are not stored: the client retries. */
export const OUTCOMES = [
  "APPLIED",
  "DUPLICATE_IGNORED",
  "REJECTED",
  "CONFLICT",
  "DEPENDENCY_MISSING",
  "RETRY",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Outcomes that are final, and so are stored with the operation id. */
export const FINAL_OUTCOMES = ["APPLIED", "REJECTED", "CONFLICT"] as const;

/** Checks the payload of one operation. Throws a ZodError-like failure the caller turns into REJECTED. */
export function parseTaskPayload(op: Pick<OpEnvelope, "type" | "entityId" | "payload">) {
  const base = typeof op.payload === "object" && op.payload !== null ? op.payload : {};
  switch (op.type) {
    case "task.create":
      return {
        kind: "create" as const,
        values: createTaskSchema.parse({ ...base, id: op.entityId }),
      };
    case "task.update":
      return {
        kind: "update" as const,
        values: updateTaskSchema.parse({ ...base, id: op.entityId }),
      };
    case "task.complete":
      return {
        kind: "complete" as const,
        values: completeTaskSchema.parse({ ...base, id: op.entityId }),
      };
    case "task.reopen":
      return { kind: "reopen" as const, values: z.strictObject({}).parse(base) };
  }
}
