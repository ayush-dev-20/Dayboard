import { z } from "zod";

// What the model must return, one schema per feature. Every model answer is parsed with one of
// these before anything else sees it. Limits here are the limits the preview UI can rely on.

export const MAX_BATCH_ITEMS = 15;

/** A task found in text (features A and D). `dueDate` may come back as a phrase; see `dates.ts`. */
export const extractedTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueDate: z.string().trim().max(40).nullish(),
  owner: z.string().trim().max(80).nullish(),
  evidence: z.string().trim().max(80).nullish(),
});
export type ExtractedTask = z.infer<typeof extractedTaskSchema>;

export const extractTasksSchema = z.object({
  items: z.array(extractedTaskSchema).max(MAX_BATCH_ITEMS),
});
export type ExtractTasksOutput = z.infer<typeof extractTasksSchema>;

export const subtasksSchema = z.object({
  subtasks: z
    .array(z.object({ title: z.string().trim().min(1).max(200) }))
    .min(3)
    .max(8),
});
export type SubtasksOutput = z.infer<typeof subtasksSchema>;

export const OVERDUE_ACTIONS = ["KEEP", "RESCHEDULE", "ARCHIVE", "CANCEL"] as const;
export type OverdueAction = (typeof OVERDUE_ACTIONS)[number];

export const overdueProposalSchema = z.object({
  taskId: z.uuid(),
  action: z.enum(OVERDUE_ACTIONS),
  newDueDate: z.string().trim().max(40).nullish(),
  reason: z.string().trim().min(1).max(100),
});
export const overdueCleanupSchema = z.object({
  proposals: z.array(overdueProposalSchema).max(30),
});
export type OverdueCleanupOutput = z.infer<typeof overdueCleanupSchema>;

export const rewriteSchema = z.object({
  title: z.string().trim().min(1).max(500).nullish(),
  description: z.string().trim().min(1).max(5000),
});
export type RewriteOutput = z.infer<typeof rewriteSchema>;

export const ESTIMATES = ["≤15m", "≤1h", "half-day", "1 day", "multi-day"] as const;
export const estimateSchema = z.object({
  estimate: z.enum(ESTIMATES),
  rationale: z.string().trim().min(1).max(300),
});
export type EstimateOutput = z.infer<typeof estimateSchema>;

export const nextStepsSchema = z.object({
  steps: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
});
export type NextStepsOutput = z.infer<typeof nextStepsSchema>;

export const INBOX_TYPES = ["TASK", "TODO", "NOTE", "TASK_AND_NOTE", "PROJECT_IDEA"] as const;
export type InboxSuggestionType = (typeof INBOX_TYPES)[number];
export const classifyInboxSchema = z.object({
  type: z.enum(INBOX_TYPES),
  title: z.string().trim().min(1).max(200),
  confidence: z.enum(["high", "medium", "low"]),
});
export type ClassifyInboxOutput = z.infer<typeof classifyInboxSchema>;

/** What is stored on `inbox_items.ai_suggestion`: low-confidence answers are never kept. */
export const storedSuggestionSchema = z.object({
  type: z.enum(INBOX_TYPES),
  title: z.string().min(1).max(200),
  confidence: z.enum(["high", "medium"]),
});
export type StoredSuggestion = z.infer<typeof storedSuggestionSchema>;

export const dailySuggestionSchema = z.object({
  text: z.string().trim().min(1).max(280),
});
export type DailySuggestionOutput = z.infer<typeof dailySuggestionSchema>;

// ---- Voice capture (V2 feature 13 §5) -----------------------------------------------------------

export const MAX_VOICE_ITEMS = 10;
export const VOICE_KINDS = ["TASK", "TODO", "NOTE"] as const;
export type VoiceKind = (typeof VOICE_KINDS)[number];
export const VOICE_CONFIDENCE = ["high", "medium", "low"] as const;
export type VoiceConfidence = (typeof VOICE_CONFIDENCE)[number];

/** One thing the model heard. `dueDate` may be a phrase; the server resolves it (never trusting the model). */
export const voiceItemSchema = z.object({
  kind: z.enum(VOICE_KINDS),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(5000).nullish(),
  dueDate: z.string().trim().max(40).nullish(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).nullish(),
  projectMention: z.string().trim().max(120).nullish(),
  people: z.array(z.string().trim().min(1).max(80)).max(10).nullish(),
  confidence: z.enum(VOICE_CONFIDENCE),
});
export type VoiceItemOutput = z.infer<typeof voiceItemSchema>;

/** The transcript itself is not asked for again: it comes from the transcription step. */
export const voiceParseSchema = z.object({
  language: z.string().trim().min(1).max(20),
  suggestedNoteTitle: z.string().trim().max(200).nullish(),
  // No \`.max()\` on the list: Gemini refuses ("invalid argument") a schema with a list limit around items that
  // have a list limit of their own (\`people\`), checked against the real API. The server keeps the first
  // ten (\`finishParse\`), so a long answer is trimmed, not rejected.
  items: z.array(voiceItemSchema),
});
export type VoiceParseOutput = z.infer<typeof voiceParseSchema>;
