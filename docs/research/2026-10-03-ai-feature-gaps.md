# AI features: what Dayboard has, what competitors offer, what to add next

**Date:** 2026-10-03
**Status:** Research and recommendation. No code changed.
**Question:** What AI features does Dayboard have today, what do products like Notion and Jira offer, and which 2–3 features should we add next?

## The short answer

Dayboard already covers the basics (text to tasks, subtasks, summaries, Ask with sources, a daily brief, overdue cleanup). The clearest gaps against the market are **planning help**, **writing help inside notes**, and **auto-organizing on capture**. Those are the three recommended next, in that order. Voice capture, weekly review and natural-language filters are good next steps after them.

---

## 1. What Dayboard has today

All nine AI features are built (feature 05). Each one is user-triggered and previewed, and nothing is saved until the person confirms.

| Feature                                                        | Where it appears          |
| -------------------------------------------------------------- | ------------------------- |
| Turn messy text into tasks                                     | Inbox ("Turn into tasks") |
| Suggest what an inbox item is (task, todo, note, …)            | Inbox ("Suggest")         |
| Break a task into subtasks                                     | Task detail               |
| Rewrite or clarify a task, estimate effort, suggest next steps | Task detail               |
| Summarize a note                                               | Note menu                 |
| Extract action items from a note                               | Note menu                 |
| Ask your workspace, with clickable sources                     | ⌘K, Ask tab               |
| Daily brief (one sentence)                                     | Today                     |
| Overdue cleanup (keep, reschedule, archive or cancel)          | Today                     |

## 2. What competitors offer

| Product                                                                                | AI features                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Notion](https://www.notion.com/product/ai)**                                        | Agent for multi-step work, writing help inside pages, **Autofill** for database fields, meeting notes, cross-app search with citations, custom agents on a schedule. Full access needs the [$20 per seat Business plan](https://www.eesel.ai/blog/notion-ai-review).                                                                                                                                                               |
| **[Jira (Rovo)](https://www.atlassian.com/software/jira/ai)**                          | Work breakdown into subtasks, an instant summary of a work item, "similar work items", a work-readiness checker, agents you can assign work to, and a [Delivery Agent](https://community.atlassian.com/forums/Jira-articles/Introducing-the-Jira-2026-Summer-Release-%EF%B8%8F/ba-p/3268349) that writes standup digests and status updates. Most of it needs [Premium or Enterprise](https://planyway.com/blog/jira-ai-features). |
| **[Linear](https://linear.app/docs/triage)**                                           | Triage Intelligence suggests an owner, labels and **duplicates** for each new issue. The person accepts or dismisses each suggestion, or opts in to auto-apply.                                                                                                                                                                                                                                                                    |
| **[Todoist](https://www.aitools-directory.com/tools/todoist-ai-smart-task-planning/)** | Task Assist (subtasks and due dates), **Filter Assist** (plain English becomes a filter), Email Assist, and **Ramble** (speak, get tasks).                                                                                                                                                                                                                                                                                         |
| **Sunsama, Motion, Reclaim**                                                           | Sunsama has a [guided morning planning ritual](https://dupple.com/reviews/sunsama): review, estimate, choose. It does not auto-schedule. Motion and [Reclaim](https://reclaim.ai/blog/motion-alternatives) auto-schedule your calendar.                                                                                                                                                                                            |

**What I could not verify.** The Todoist help page for Ramble would not load, so the Ramble details come from a review site. Most pricing and plan details come from review blogs, not from the vendors. Treat the table as a market overview, not a spec.

## 3. Gaps confirmed in the code

I searched the code (not just the docs) to be sure each of these is really missing.

- **No writing help in notes.** The note menu only has Summarize and Extract tasks. Notion's inline writing help is one of its best-known features.
- **No auto-organizing on capture.** The inbox suggestion returns only a type, a title and a confidence level. It never sees the person's projects or tags, so it cannot suggest a project, tags or a due date (compare Notion's Autofill and Linear's labelling).
- **No planning help.** The daily brief is one sentence. Effort estimates are shown but **never stored** (there is no estimate column), so nothing can plan around them.
- **Quick add does no natural-language parsing.** Messy text goes through the Inbox AI route instead.
- **No voice code at all** (no microphone or recording code anywhere in `src`).
- **Ask searches the whole workspace only.** It cannot be scoped to a single note.

## 4. Recommended top 3, in priority order

### 1. Plan my day (guided, Sunsama-style)

- **What it does:** a button on Today proposes 3–5 tasks for today in a sensible order, drawn from overdue, due-today and high-priority items. The person ticks or unticks, then confirms. Confirming sets the due date and the Focus task.
- **Why first:** it is the "Plan" step of Dayboard's own loop (Capture → Organize → Execute → Review). It uses data Today already loads, and it follows the existing rule "advisory only, never auto-schedule". It is also the most distinctive of the three.
- **Effort:** medium. One new route, one output schema, and one preview dialog reusing existing actions.
- **Catch:** without stored estimates it is a prioritized shortlist, not a time-boxed schedule. Time-boxing needs a small estimate field, or the V2 calendar.

### 2. Writing help in notes

- **What it does:** select text, then choose Improve, Shorten, Fix grammar or Continue. A before/after preview appears and the person clicks Replace or Discard.
- **Why:** it is what note users expect after Notion, and it is likely the most frequent AI action in any notes app.
- **Effort:** medium. One route and prompt, plus an entry in the editor's selection menu. The hard part is replacing the selection without losing formatting. Only the selected text is sent to the model.
- **Catch:** it will use up AI limits faster than the other two (defaults are 10 per minute and 100 per day).

### 3. Smart autofill on capture

- **What it does:** when the person clicks Suggest on an inbox item, the AI also proposes a project, tags, a due date and a priority, chosen only from the person's existing projects and tags. The convert dialog is pre-filled with them.
- **Why:** it makes "organize when useful" a one-click step on every capture. It is Notion's Autofill and Linear's labelling, applied to the person's own data.
- **Effort:** small to medium. Extend the classify schema, prompt and UI. It can follow the same safe pattern as Overdue cleanup, which drops any ID it was not sent.

## 5. Next in line (not for now)

| Idea                                     | Note                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Weekly review                            | Low effort, but it is already planned for V2 and listed as a V1 non-goal.                                                                                                |
| Voice capture ("speak it, review tasks") | High wow, but a bigger build (microphone, audio handling, privacy) and planned for V2. Gemini can accept audio, but this was not checked against the pinned SDK version. |
| Natural-language filters in ⌘K           | Small. Reuses the URL filters already in the app (Todoist's Filter Assist).                                                                                              |
| "Similar task" warning                   | Nice touch (Jira, Linear), but plain keyword matching would be weak. Better after semantic search in V2.                                                                 |
| Ask this note                            | Small extension of Ask.                                                                                                                                                  |
| Agents and automations                   | V3.                                                                                                                                                                      |

## 6. Things to keep in mind

- Features 1–3 all fit the existing rules: user-triggered, previewed, and no writes without a confirm click.
- V1 non-goals (product spec §3) include voice, meeting transcription, semantic search and AI weekly reports. V2 already plans voice, semantic search, an AI assistant and a weekly review. Pulling any of these forward should be a deliberate decision, ideally with an ADR.
- On Gemini's free tier, Google may use content to improve its products. Settings → AI already says so. Writing help sends more of the person's text than the other two, so it is the one to think about first.
- Many competitor AI features are paid or team features. That supports keeping Dayboard's set small and sharp.

## 7. Open questions for the owner

1. Which of the three to build first? (Recommendation: Plan my day.)
2. Should Plan my day stay a shortlist, or should we add an optional estimate field so it can time-box?
3. Is it acceptable to pull voice capture or weekly review forward from V2, or should they wait?

## Sources

- Notion: [AI product page](https://www.notion.com/product/ai), [Notion AI review 2026](https://www.eesel.ai/blog/notion-ai-review)
- Jira: [Rovo in Jira](https://www.atlassian.com/software/jira/ai), [Jira 2026 Summer Release](https://community.atlassian.com/forums/Jira-articles/Introducing-the-Jira-2026-Summer-Release-%EF%B8%8F/ba-p/3268349), [Jira AI features explained](https://planyway.com/blog/jira-ai-features)
- Linear: [Triage](https://linear.app/docs/triage)
- Todoist: [Todoist AI overview](https://www.aitools-directory.com/tools/todoist-ai-smart-task-planning/) (secondary source)
- Planning tools: [Sunsama review](https://dupple.com/reviews/sunsama), [Motion alternatives (Reclaim)](https://reclaim.ai/blog/motion-alternatives)
- Project files checked: `agent_docs/ai-assistant_v1.md`, `src/app/api/ai/`, `src/lib/ai/prompts.ts`, `src/lib/ai/schemas.ts`, `src/components/notes/note-editor.tsx`, `specs/v1/01-product-spec.md`, `specs/v2/01-product-spec.md`
