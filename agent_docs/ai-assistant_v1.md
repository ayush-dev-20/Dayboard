# Feature: AI assistant

**Phase:** V1
**Status:** Done
**Date:** 2026-10-02

## What was built

- **Provider layer** in `src/lib/ai/`: an `AIProvider` interface, a Vercel AI SDK adapter (Anthropic only, see ADR 0004) and a deterministic **mock** (the default outside production, and forced when `E2E=true`). The facade (`index.ts`) adds the 30 s / 60 s timeouts, one retry (outage, or invalid output with a repair hint), Zod validation of every answer, and one `ai_usage` row per call.
- **Nine routes** under `src/app/api/ai/`: extract-tasks, subtasks, summarize-note (stream), action-items, ask (stream + sources), daily-suggestion, overdue-cleanup, task-assist, classify-inbox. Each goes through `gate.ts` (sign-in, AI on, Zod, limits), loads records **by id and owner**, and never writes workspace data. Streams are one JSON event per line.
- **UI**, all hidden when `useWorkspace().aiEnabled` is false: Inbox "Suggest" chip and "Turn into tasks"; task detail "AI actions" (subtasks, rewrite/clarify, estimate, next steps); note menu Summarize and Extract tasks; command menu **Ask** tab; Today daily card and "Help me clean up"; Settings → AI usage and data notice.
- **Confirm step everywhere:** previews are checklists or side-by-side views. Only the confirm click writes, through `createTasksBatch` (new Server Action, max 15, one transaction) or the existing task actions.

## Why

The feature doc requires AI to be contextual, always previewed, never blocking, and unable to read another person's data. Keeping the provider behind an interface and the mock as the default means tests and CI cost nothing and the app works with no key.

## What was deferred

- `AI_PROVIDER=openai` (the feature doc lists it): not wired, see ADR 0004.
- Ask's relation bonus uses shared **project** only, not shared tags.
- No keyboard shortcut for Ask (Tab cycles Search, Ask, Create in the menu).
- The client bundle check (`pnpm check:bundle`) exists but no CI workflow runs it yet; wire it in feature 06.
- Not built, per the feature doc: embeddings, weekly review, auto-scheduling, multi-turn chat, background runs, per-user models.

## Related files

- `src/lib/ai/gate.ts`: pipeline steps 1–4 and the stream response helper. `index.ts`: retries, validation, usage. `usage.ts` and `limits.ts`: limits (pure part in `limits.ts`).
- `src/lib/ai/context.ts`: Ask retrieval (keywords, ranking, budget, S1…S12, citation filter, quote check). `src/db/queries/ai.ts`: the owner-scoped reads.
- `src/lib/ai/prompts.ts`, `schemas.ts`: versioned prompts (`*_V1`) and output schemas. `src/lib/dates/resolve.ts`: relative dates ("friday", "Oct 3") against the person's day.
- `src/db/schema/ai.ts`, migration `0004_ai-assistant.sql`: `ai_usage`, `ai_daily_suggestions`.
- `src/components/ai/`: shared states (`ai-ui.tsx`), `use-ai.ts` (Ready/Generating/Complete/Failed hooks), the tasks preview dialog, the Ask panel. Surfaces: `inbox/inbox-ai.tsx`, `tasks/task-ai.tsx`, `notes/note-ai.tsx`, `today/ai-suggestion-slot.tsx`, `today/overdue-cleanup.tsx`.
- `scripts/check-client-bundle.mjs`: fails if `.next/static` holds the key name or an `sk-` key.

## Hand-off notes

- **Mock markers:** `[mock:error]` or `[mock:slow]` in the person's text makes only that call fail or lag, so one server serves normal and failing tests. `AI_MOCK_MODE` does the same for every call.
- **Usage:** rate-limited attempts are recorded but not counted, so waiting never extends the wait. The Today card's suggestion counts as one action a day, and it runs on the first Today visit of the day. In dev, React Strict Mode may request it twice.
- **Limits:** per-minute window is rolling; the day is the person's calendar day (midnight to midnight), not their start-of-day.
- **Beyond the feature doc:** `createTasksBatch` also takes `fromInboxItemId` (marks the inbox item converted, same transaction) and `projectId`. "Turn into tasks" on an inbox item uses it. `RATE_LIMITED` errors carry `retryAfterSeconds` and a `Retry-After` header. `ai_daily_suggestions.refresh_count` enforces one refresh a day. Ask quotes (`> ` lines) are shown as "From your workspace" only if the server finds the text in the records it sent.
- **Design notes:** the design shows the overdue action as one label ("Reschedule to Oct 2"); built as an action menu plus a date chip. "Apply N" counts ticked rows including Keep, as in the design. `designs/*.html` were not changed.
- Related: `inbox-today-search-trash_v1.md` (the slots this fills), `tasks-and-todos_v1.md`, `notes-projects-tags_v1.md`, ADR 0004.
