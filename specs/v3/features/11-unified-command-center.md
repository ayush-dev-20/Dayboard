# Feature 11 — Unified Command Center (V3)

> **Build position: eleventh V3 feature.** The V3 plan has no phase of its own for it; it comes after the agent runtime (09) because it is where AI commands and automation actions are reached. Parts of it can be built earlier as each feature lands (see "Order of work"). Behaviour is in V3 product spec §13. Where this doc is more detailed, this doc wins for this feature.

## 1. Scope

The command menu already exists (V1 feature 04 and V1 AI): `⌘K` opens one cmdk dialog with **Search**, **Ask** and **Create** modes, and **Quick capture** one key away, on desktop and phone. This feature makes it the single door to everything the app can do, by putting the actions behind a **typed command registry** instead of a hard-coded list, and adding the V3 abilities:

- **Navigate** to every page and to recent items.
- **Create** a task, todo, note, note from a template, journal entry, canvas, project.
- **Search** (unchanged) and **Ask** (unchanged).
- **AI commands:** Draw a diagram with AI, Run the assistant on a goal (agent, feature 09), Summarise this note, Open in assistant.
- **Automation actions:** Run an automation now, turn one on or off, open the activity.
- **Context commands** for the page you are on (note, task, project, canvas): share, archive, copy link, open comments, link a task to this canvas.
- The **same command model on desktop and mobile.**

Reuses: `src/components/command/` (`command-menu.tsx`, `command-context.tsx`, `capture-box.tsx`, `command-provider.tsx`), `cmdk`, `/api/search`, the Ask stream, the workspace context (`aiEnabled`, counts, projects), `AppShortcuts`, the shared picker list, feature gates from each feature.

Packages: none.

Source spec sections: V3 product §13, UI/UX spec (V1 §command menu, V3 §13 mobile), `../Agent.md` §3.

### Order of work

| Slice | Content | Visible result |
|---|---|---|
| **A** | The registry, the existing quick actions and navigation moved onto it, recents, the context group | Nothing looks different; it is now extendable |
| **B** | New commands as features land (journal, templates, canvas, sharing, comments) | Each feature is one entry in the registry |
| **C** | AI and automation commands, argument steps, mobile sheet polish | One door for everything |

Slice A can be done any time after V3 feature 03; B is a few lines per feature and belongs in that feature's own checklist; C needs 08 and 09.

---

## 2. The command registry

`src/lib/commands/registry.ts` (pure data and small functions, importable by the client):

```ts
type Command = {
  id: string;                          // stable, kebab-case: "journal-today"
  title: string;                       // "Journal: today's entry"
  keywords?: string[];                 // extra words that find it
  group: "navigate" | "create" | "ai" | "automate" | "context";
  icon: LucideIcon;
  shortcut?: string;                   // display only; real shortcuts stay in shortcuts.ts
  when?: (ctx: CommandContext) => boolean;     // pure: availability
  run:
    | { type: "href"; href: string | ((ctx) => string) }
    | { type: "action"; id: ActionId }           // a client function in a map, never a string eval
    | { type: "pick"; picker: PickerId; then: ... }   // opens a second step (§3)
    | { type: "ai"; prompt?: string };               // hands text to Ask or the assistant
};
type CommandContext = {
  aiEnabled: boolean; agentEnabled: boolean;
  route: { kind: "note" | "task" | "project" | "canvas" | "journal" | "other"; id?: string };
  role: Role | null;                    // from feature 04 once it exists (owner otherwise)
  features: { journal: boolean; templates: boolean; canvases: boolean; automations: boolean; sharing: boolean; comments: boolean };
};
```

- **Features contribute commands; the menu does not know them.** Each feature adds its entries to the registry in its own file (`journal.commands.ts`, `canvas.commands.ts`, …) and the registry file imports them. A feature that is switched off or unavailable (AI off, no calendar, `SHARING_ENABLED` false) returns `when: false`, so the command is absent, never disabled-looking.
- **`when` is availability only,** never authorization. The server action behind a command still checks everything (`CLAUDE.md` §9).
- **No dynamic code:** commands name actions from a typed map; nothing is built from strings.
- Command ids are unique and stable (tests); renaming a title never changes the id (recents depend on it).

### First set

| Group | Commands |
|---|---|
| Navigate | Today, Inbox, Tasks, Notes, Journal, Canvases, Projects, Templates, Assistant, Automations, Search, Trash, Settings (each its own tab), Settings → Memory, Settings → Devices |
| Create | New task, New todo, New note, New note from template…, New journal entry (today's), New canvas, Draw a diagram with AI…, New project, New template, New automation |
| AI | Ask your workspace (switches to Ask), Run the assistant on a goal… (feature 09), Summarise this note (context), Open in assistant |
| Automate | Run automation…, Turn automation on…, Turn automation off…, Open automation activity, Review approvals (with the count) |
| Context | Note: Share, Copy link, Archive, Comments, Link a task. Task: Share project, Link a note, Link a canvas, Comments. Canvas: Draw with AI, Link a task, Export. Project: Share |

---

## 3. Behaviour

- **Modes stay.** Search, Ask, Create and Quick capture keep their keys and behaviour (they are shipped and tested). The registry feeds them: Create mode lists the `create` group; the empty Search state lists Quick actions (a short pinned subset), Recent searches and Recent items as today.
- **Commands in Search mode:** when the typed text matches commands, a **Commands** section appears above or below hits (commands first for short queries that match a title closely, hits first otherwise). A leading `>` shows **commands only**, across all groups; `?` is not added (Ask already has its mode and `looksLikeQuestion`).
- **Arguments in a second step.** A command of type `pick` (New note from template…, Run automation…, Turn automation on…) swaps the list for a searchable picker in the same dialog (the shared picker list); `Esc` or Backspace on an empty field goes back one step; choosing runs the command. Free-text arguments ("Run the assistant on a goal…", "Draw a diagram with AI…") open a one-line input with the same keys and hand the text to the target feature (the Draw with AI dialog, or a new agent run).
- **Recents:** the last 5 commands run on this device are listed first when the field is empty (stored in `localStorage` by command id, wrapped in try/catch; unknown ids are ignored). No server storage and no analytics.
- **Ranking:** cmdk's matching on title and keywords for commands; hits keep their server ranking. Duplicate destinations (a nav item and a recent item) are shown once.
- **Context group:** shown (first) when the route is a note, task, project, canvas or journal entry and the person's role allows it. Replaces the current note-only special case in `command-menu.tsx`.
- **Running a command** closes the menu, then acts. Errors show a toast with the plain message from the action; the menu is never left half-open.
- **Shortcuts:** the menu itself keeps `⌘K` and the existing mode keys. Commands may *display* a shortcut but registering real shortcuts stays in `src/lib/shortcuts.ts` and `AppShortcuts`; a test checks displayed shortcuts match real ones.

---

## 4. Mobile

The same registry and the same component; only the presentation changes.

- Opened from the top bar's search button (already present) and from the **bottom navigation's More** page; the capture button stays.
- Presented as a **full-height sheet** with the search field at the top (the keyboard never covers the list), 44 px rows, command and hit rows identical to desktop, and a visible **Back** control for the second step.
- Groups are collapsed to the five most relevant until the field has text, so the sheet is not a long page.
- No hover-only information; every command has an icon and text.

---

## 5. Server and data

No new tables. New or changed server pieces:

- Commands call **existing actions and routes** (create, link, archive, share, run automation, start an agent run). A command never gets its own privileged endpoint.
- `/api/search` already filters by access once feature 04 lands; the menu inherits it.
- The `pick` steps use existing query actions (`listTemplates`, `listAutomations`, …) with small limits (20) and the person's access.
- An optional `GET /api/commands/context` is **not** added; availability comes from the workspace context already in the page.

---

## 6. Rules

- **One registry.** No second list of actions in a component. The old `QUICK_ACTIONS` array and the per-page special cases are removed when slice A lands.
- **Availability is not authorization.** The server decides.
- **No new keyboard clashes:** a test compares registered display shortcuts to the real map.
- **Accessibility:** cmdk's combobox roles stay; the group headings are real headings; a second step announces its title ("Choose a template"); results count is announced politely and rarely; every row has a text label.
- **Reduced motion** respected (no new animation).
- **No private text in telemetry** (there is none) or logs.
- **Do not turn the menu into a settings page:** commands run actions or navigate; they do not hold preferences.

---

## 7. Tests

**Unit**
- Registry validity: ids unique and kebab-case; every `href` resolves to a known route pattern; every `action` id exists in the action map; every `pick` names a registered picker; titles are plain strings; each command has an icon.
- `when` matrix: AI off hides AI commands; agents off hides the run command; no automations hides the automation group; sharing off hides Share; the context group follows the route kind and role.
- Recents: store, de-duplicate, drop unknown ids, survive unavailable storage.
- Displayed shortcuts match `shortcuts.ts`.
- Query handling: `>` shows only commands; a short query ranks title matches first.

**Integration**
- Commands that call actions get the same results and errors as the pages that call them (create task, note from template, journal entry, canvas, run automation, start a run, link a canvas to a task); another person's id is `NOT_FOUND`.

**E2E**
1. `⌘K` → type `journal` → Enter opens today's entry; `>`-only list shows commands; recents show it next time.
2. Create → New note from template… → pick → the note opens with the content.
3. On a note page the Context group offers Share, Comments, Link a task; on a viewer's read-only note only the allowed ones appear.
4. With AI off, no AI commands; with it on, "Draw a diagram with AI…" opens the dialog with the text.
5. Run an automation from the menu; the activity shows the run.
6. At 360 px the sheet opens from the search button, the keyboard does not cover results, Back works in a second step.
7. Axe on the dialog (desktop and sheet), light and dark; keyboard-only path through a pick step.

Existing command menu tests (search, ask, create, capture) pass unchanged.

---

## 8. Definition of done

- [ ] The registry replaces the hard-coded actions and special cases; existing modes and tests are unchanged
- [ ] Navigate, Create, AI, Automate and Context commands exist for every shipped feature and disappear when a feature is off
- [ ] Argument steps work by keyboard and touch, and Back goes one step
- [ ] The same registry and flow work on desktop and at 360 px
- [ ] Every command goes through an existing, access-checked action; availability is never treated as authorization
- [ ] Recents work per device and fail quietly without storage
- [ ] No shortcut conflicts; axe passes; reduced motion respected
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` pass
- [ ] `agent_docs/unified-command-center_v3.md` written and indexed; an "As built" section here lists every deviation

---

## 9. Out of scope (this feature)

- Free-form natural-language commands that the app interprets into actions on its own (the assistant and agent runs are the AI route).
- User-defined commands, macros or key bindings.
- A server-side command history or usage analytics.
- A command to delete anything permanently, to change permissions in bulk, or to edit settings.
- Plugins or third-party commands.
