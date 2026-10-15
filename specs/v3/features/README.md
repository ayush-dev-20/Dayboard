# V3 Feature Specs

Each file in this folder is one buildable V3 feature: a technical breakdown of what to build, in the same shape as the V1 and V2 feature docs (Scope, Data model, Server contract, UI, Rules, Tests, Definition of done, Out of scope). The product behaviour lives in `../01-product-spec.md`; where a feature doc here is more detailed or newer, **the feature doc wins** for that feature, and the top-level spec should be updated to match. Do not silently diverge.

Build them in order. Each feature leaves the app runnable and depends only on features before it, plus V1 and the V2 pieces named below.

| # | Feature | Covers (V3 product spec §) | Depends on |
| --- | --- | --- | --- |
| 01 | [Canvas with AI Diagrams and Sticky Boards](01-canvas-with-ai-diagrams.md) **(build first)** | Canvases tab and list, Excalidraw page, task links, note/task/project cards, Draw with AI, refine, Outline, export; **sticky boards** (status columns; sticky notes are tasks of their own kind, shown in Today) as slice D (§4, goal 1) | V1; V2 11 (audit log); V2 07 (note picker, soft) |
| 02 | [Journal (Daily Notes)](02-journal-daily-notes.md) | Journal tab, one entry per day in the note editor, auto title, Done on this day, folding sidebar section (§5, goal 2) | V1; V2 notes (built); 03 (starting template, slice C) |
| 03 | [Templates](03-templates.md) | Templates tab, editor, placeholders, New note from template, journal template, starters (§6, goal 3) | V1; V2 notes (built); 02 (for slice B) |
| 04 | [Permissions & Sharing](04-permissions-and-sharing.md) | Roles, grants, invitations, the authorization module, ACL test suite, Shared with me (§7, goals 4 and 6) | V1; 02, 03 (to state what is not shareable) |
| 05 | [Real-time Collaboration](05-realtime-collaboration.md) | Live note editing, presence, collaboration service, snapshots, reconnect (§8, goal 5) | 04 |
| 06 | [Comments, Mentions & Notifications](06-comments-and-mentions.md) | Threads on notes and tasks, mentions, notification centre, mention email (§9) | 04; 05 (soft: instant refresh) |
| 07 | [Domain Events & Outbox](07-domain-events-and-outbox.md) | Event catalogue, outbox in transactions, dispatch with retries, correlation ids, loop guard (technical §5) | V2 08 (worker) |
| 08 | [Automation Engine](08-automation-engine.md) | Triggers, conditions, actions, preview and test, runs, approvals (§10, goal 7) | 07; 03 (note from template), 06 (notify me) |
| 09 | [AI Agent Runtime & Approvals](09-ai-agent-runtime.md) | Tool registry, staged changes, approvals, execution timeline, limits, and an MCP server so external AI tools (Claude Code, Gemini CLI) can use the same tools (§11, goal 8) | 04, 08 (approvals), V2 11 |
| 10 | [Memory Controls](10-memory-controls.md) | Explicit memories, categories, sources, use shown, forget (§12) | V2 11; 09 (agent tool, soft) |
| 11 | [Unified Command Center](11-unified-command-center.md) | Command registry, navigate / create / AI / automate / context commands, mobile sheet (§13) | V1; each feature adds its commands; 08, 09 for slice C |
| 12 | [Account & Device Center](12-account-and-device-center.md) | Devices, security activity, data export, safe account deletion, notification devices (§14, goal 9) | V1 sessions (built); V2 08 (jobs); V2 09, 14 (files, push) as available |
| 13 | [Scale, Reliability & Observability](13-scale-reliability-and-observability.md) | Correlation ids, metrics, traces, alerts, operator page, staging, drills, supply chain, cost (technical §11 to §14, goal 10 and 11) | all (starts early, see note) |

**Priority (owner, 2026-10-13):** 01 is built first. 02 and 03 follow it, ahead of the permission work, because they need only V1 and the notes that already exist. Everything from 04 onward keeps the order of the V3 plan (`../05-project-plan.md`): permissions, collaboration, comments, events, automation, agents, memory, devices, scale. Feature 11 has no phase in the plan; its first slice can be done at any time after 03 and each later feature adds its own commands. Feature 13's first slice (correlation ids, health, staging, CI checks) should land with 05.

## V2 prerequisites that are not built yet

These V2 features are not done today (see `agent_docs/README.md`). V3 features that need them say so; build them first or use the stated fallback.

| V2 feature | State | Needed by | Fallback if absent |
| --- | --- | --- | --- |
| 08 Background worker and jobs | Not built | 07, 08, 09 (runs), 12 (export, deletion sweep), 13 | None for 07 to 09. 12 can run deletion and export inline for small workspaces at first |
| 14 Push notifications | Not built | 12 (notification devices) | The section stays hidden |
| 12 Google Calendar | Not built | 09 (`getCalendar` tool) | The tool is not registered |
| 09 Files on object storage | In progress | 12 (files in the export) | The export lists files as skipped |
| 04 and 05 Offline and sync | Skipped on purpose | All V3 data is server-backed like notes today | Real offline editing is out of V3's first release |
| 10 Semantic search | Not built | Optional for 09, 10 | Lexical search behind the same seam |

## Traceability

| V3 product spec requirement | Feature |
| --- | --- |
| §4 canvas, Canvases tab, task links, Draw with AI, refine, Outline, sticky boards (goal 1) | 01 |
| §5 journal: own tab, same editor, auto title, Done on this day, collapsible section (goal 2) | 02 |
| §6 templates: own tab, placeholders, journal template (goal 3) | 03 |
| §7 collaboration roles, sharing, permissions (goals 4 and 6) | 04 |
| §8 real-time editing, presence (goal 5) | 05 |
| §9 comments, mentions, notifications | 06 |
| §10 automation (goal 7) | 08 (on 07's events) |
| §11 AI agent layer, approvals (goal 8) | 09 |
| §12 personal memory | 10 |
| §13 unified command center | 11 |
| §14 account and device management (goal 9) | 12 |
| Goals 10 and 11 (observability, scalable infrastructure); technical §11 to §14; DevOps spec | 13 (with 05 and 07) |
| Technical §5 domain events and outbox | 07 |
| Technical §15 export and deletion | 12 |

| V3 success criterion (§15) | Verified in |
| --- | --- |
| 1 Draw on a canvas and have AI draw a connected, sectioned diagram | 01 |
| 2 Write a daily journal entry in one click and see what was completed listed in it | 02 |
| 3 Start notes and journal entries from templates | 03 |
| 4 Collaborate on a selected project or note | 04, 05 |
| 5 Discuss work through comments | 06 |
| 6 Automate repetitive actions | 08 (with 07) |
| 7 Ask AI to prepare multi-step work | 09 |
| 8 Approve selected AI actions | 08, 09 |
| 9 Manage devices | 12 |
| 10 Understand and control stored AI memory | 10 |

## How to use these docs

- Read `../Agent.md` and the V3 specs first, then the feature doc. `CLAUDE.md` section 3 lists the V1 files to read every time.
- Each doc follows: Scope → Data model → Server contract → UI → Rules → Tests → Definition of done → Out of scope, with an "Order of work" table of slices that can ship separately.
- When a feature is built, write `agent_docs/{feature-name}_v3.md` and add its index line to `agent_docs/README.md`. Add an "As built" section to the feature doc with every deviation, as the V1 and V2 docs do.
- The top-level V3 technical, UI/UX, DevOps and plan specs (`../02` to `../05`) have **not yet been updated** for features 02, 03 and the Canvases tab and task links (the canvas parts of those specs are current). Their needs are listed at the end of product spec §6; update them when the features are built.
- ADRs are required **before** building anything that departs from the stack in `CLAUDE.md`. The ones these docs expect are listed below.

## Cross-cutting conventions (apply to every V3 feature)

**Ownership and access.** Until feature 04, every query and mutation is scoped to the signed-in user, as in V1 and V2. From feature 04, every command resolves `actor → resource → permission → action` through the one authorization module; a person with no access gets `NOT_FOUND`, a person who can see but not do gets `UNAUTHORIZED`. Hiding a button is never the check. New tables carry `user_id` with `ON DELETE CASCADE`, which feature 12's deletion test enforces.

**Private by default.** Canvases, journal entries, templates, memories, automations and agent runs are private to their owner. Sharing covers projects and notes only (feature 04).

**AI rules** (`../Agent.md` §4, §8; V2 `../../v2/Agent.md` §5). All AI goes through the provider adapter and its mock. Output is validated with Zod. Anything that changes data is a proposal until the person confirms, one apply per proposal, with an audit row that holds counts and ids, never private text. CI never calls a paid provider. A real-model run is recorded before a feature that depends on a model is called done.

**Migrations** are expand-only and staged (`../Agent.md` §9). Never edit an applied migration. The `audit_log.source` check widens as features land (`CANVAS`, `AUTOMATION`, `AGENT`, and sharing); if two features land together, one migration widens to the union.

**Modules.** New V3 code lives under `src/modules/<name>/` (`../Agent.md` §3: permissions, events, automations, agents, collaboration). Existing code under `src/lib`, `src/db` and `src/actions` is not moved. A feature extends the existing note, task and project layers instead of copying them.

**Idempotency and retries.** Anything run by the worker or an event consumer is at-least-once and must be safe to run twice, with a stated key.

**Content in logs.** Never. Logs, metrics, traces, notifications, emails and audit rows carry ids, kinds, counts and timings (`../Agent.md` §10).

**Design and accessibility.** `DESIGN.md` still applies: one accent, hairlines, red is rare, weights 400 and 600, colour never the only signal, 44 px touch targets, reduced motion, no sparkle icons, no docked chat. New screens work at 360 px and in light and dark, and pass axe.

**Tests.** Vitest for pure logic; integration tests with the real database and mock providers; Playwright for flows, using two browser contexts for anything involving two people. The AI provider is always mocked in CI. A browser behaviour that cannot be automated gets a written manual checklist in the feature's definition of done.

**New packages** are listed in each feature. Before adding one: is it required, does something we have already do the job, does it work with the pinned Next.js, React and Tiptap versions, does it complicate deployment, and what is its license? The packages these docs add are all MIT or Apache-2.0 (checked 2026-10-13 with `npm view`).

## ADRs these features expect (write before building)

| ADR | Decision | Needed by |
| --- | --- | --- |
| 0017 | Canvas: drawing library (Excalidraw), scene whitelist, layout approach, self-hosted assets (the drawing area keeps Excalidraw's own look and icons) | 01 |
| 0018 | Permission model: resource grants, roles, inheritance, no workspaces yet, `NOT_FOUND` versus `UNAUTHORIZED`, the staged switch | 04 |
| 0019 | Real-time collaboration: Yjs with Tiptap, Hocuspocus as a separate service, seeding and projection, fallback, hosting limit | 05 |
| 0020 | Domain events as the outbox, deliveries, closed catalogue, retention | 07 |
| 0021 | Automation: workflow model, fixed registry of triggers and actions, idempotent effects, approvals | 08 |
| 0022 | Agent runtime: tool registry declarations, staged operations and hash-bound approvals, worker-run loop, limits | 09 |
| 0023 | Account: device model, export format and ZIP library, deletion with grace period and ledger | 12 |
| 0024 | Observability and topology: OpenTelemetry, Prometheus-format metrics, staging isolation, scaling stance | 13 |
| 0025 | MCP server: SDK or hand-written layer, personal access tokens, stdio launcher, OAuth through Better Auth or not | 09 (slice D) |

Numbers 0006 to 0013 are reserved by the V2 docs and may still be unwritten; take the next free number if one of these is reached first.

## Suggested slicing for a first release

If V3 must ship in stages: **A** = 01 (canvas); **B** = 02, 03 (journal, templates); **C** = 04, 05, 06 (sharing, live editing, comments); **D** = 07, 08 (events, automations); **E** = 09, 10, 11 (agents, memory, command center); **F** = 12 (account); **G** = 13 throughout. A and B need nothing from V2 that is missing. C needs a host that can run the collaboration service for live editing (sharing and comments work without it). D and E need the V2 worker.
