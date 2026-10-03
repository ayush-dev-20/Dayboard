# Feature 07 — UI Modernization (Option B: modern calm SaaS)

## 1. Scope

This feature is **UI only**. It takes the working app from "a well-made document" to "a product people would pay for", without changing what the app does.

- **Design system update.** Rewrite the parts of `DESIGN.md` that block a modern look (flat-only depth, no cards, no springs, left-aligned 880px column). Update the UI spec and `CLAUDE.md` to match, and record it in an ADR.
- **Foundation.** A simpler color system built from a few inputs, soft layered depth, a bigger radius scale, and a rule that makes red rare.
- **Layout.** A dimmer sidebar, the main area as an inset panel, content that uses the screen width, one consistent page header.
- **Screens.** Rebuild **Today** first, then Tasks, Projects, Notes, Inbox, Search, Trash and Settings.
- **Motion.** The `motion` library with `reducedMotion="user"`, a small token set, and a strict "not too much" budget.
- **AI, inline.** Restyle the AI surfaces that feature 05 already built (previews, ⌘K Ask, Today brief). No chat sidebar. No new AI behavior.
- **SaaS front door.** A landing page at `/`, better sign-in and sign-up, a short onboarding, a getting-started checklist, and illustrated empty states.
- **Quality gate.** Screenshot tests, automated contrast checks, reduced-motion tests, and a responsive matrix.

**Out of scope here:** new product features, new AI routes, pricing and billing (V1 non-goal, see §14), teams, public sharing.

Source: [docs/research/2026-10-02-ui-modernization.md](../../../docs/research/2026-10-02-ui-modernization.md) (findings and the competitor and Linear references), UI/UX spec §1–§3, §13, §16, §20, `DESIGN.md`, product spec §13 ("quality bar").

**Depends on:** 01–05 (every screen exists). **Independent of:** 06 (DevOps). The two can run in parallel, and this feature must finish before the V1 launch checklist.

### What does not change

- Every Server Action, query, route, schema and Zod validation (one exception: the small checklist addition in §9.5).
- Information density: task rows stay **36px** on desktop and **44px** on touch. Option B changes the *chrome around* the lists, not the lists.
- The task-vs-todo checkbox shapes (square vs circle), the two font weights (400 and 600), the "AI never writes without a confirm click" rule, and all accessibility rules.
- Test IDs and accessible names that existing E2E tests use. Restyling must not break them.

---

## 2. Design direction and decisions

### 2.1 Direction

**Option B: modern calm SaaS.** Keep the identity (warm paper, ink-blue accent, Inter). Add what a premium product has: soft depth, cards that earn their place, spring-based motion, a recognizable but quiet AI style, a real landing page. Linear is the model for restraint: calmer and dimmer chrome, content stands out, very few colors.

### 2.2 Decisions with defaults

An agent starts from these defaults. The owner can change any of them in Milestone 0 (§12).

| # | Decision | Default | Why |
| --- | --- | --- | --- |
| D1 | Font | **One family: Inter**, with its optical-size axis (`opsz`) for headings, as in ADR 0003. Verify `@fontsource-variable/inter/opsz.css` exists in the pinned version before relying on it. | Matches the built app; fixes the drift with `DESIGN.md`, which still names Newsreader and IBM Plex. Linear does the same with Inter Display. |
| D2 | AI identity | **Tinted panel + the words "AI-generated". No sparkle icon, no badge.** | Sparkle icons are the most common "AI slop" tell; the tint is enough to set AI content apart. |
| D3 | Content alignment | Content column **centered in the main panel**; text inside stays left-aligned. | Uses wide screens, like Notion and Linear. Replaces the "flush-left" rule. |
| D4 | Landing page copy | Built with **no invented social proof** (see §10.2). Pricing section omitted. | The product has no customers, logos or stats to show, and billing is out of scope in V1. |
| D5 | Sample data in onboarding | **Optional, last milestone** (§9.6). | Nice for first impressions, but it is extra data logic. |
| D6 | Brand mark | A simple SVG mark plus the wordmark, produced in Milestone 0. | The app has only a text wordmark today. |

---

## 3. DESIGN.md, UI spec and CLAUDE.md changes (Milestone 0)

`DESIGN.md` is read-only for feature work. **This feature is the owner's approval to rewrite it.** Do this first, in one change, before touching code.

### 3.1 What changes in DESIGN.md

| Section | Today | Becomes |
| --- | --- | --- |
| Overview | "Paper Daybook"; "gives up cool, techy polish"; three commitments | Name it "Paper Daybook, modern calm". The sacrifice becomes "neon, glow and loud brand effects". Commitments: (1) one accent, one job (unchanged); (2) **hairlines by default, cards only for one discrete object** (project, note, focus, product frame); (3) AI is a quiet clerk, now with a tinted panel. |
| Colors | ~43 hand-picked tokens; red used on every overdue chip | Tokens generated from three inputs (§5.1). Add `ai-surface`, `ai-border`, `landing-wash`. Add the **red-is-rare** rule (§5.3). The values in the YAML come from the generator output. |
| Typography | Newsreader + IBM Plex Sans + IBM Plex Mono (stale since ADR 0003) | Inter with `opsz`. Keep the type roles (display, headline-lg/md/sm, body-lg/md/sm, label-md/caps, data-md/sm, kbd). Add `hero` (landing: 56px mobile 40px, tracking −0.03em). Keep weights 400 and 600 only. |
| Layout | "Flush-left, 880px, no centered layouts" | Inset main panel, centered content column (`content` 960px, `wide` 1200px, `editor` 760px unchanged), two-column Today at ≥1280px, sticky page header. Landing uses `max-w-6xl`. |
| Elevation & Depth | "Flat by default, shadows only on floating layers" | **Four levels** (§5.2). Static cards get `xs`; floating layers keep `lg`. Dark mode uses border + inner highlight instead of shadow. |
| Shapes | 3 / 6 / 10px | 4 / 8 / 12 / 16px (§5.2). Checkbox shapes unchanged. |
| Motion & Interaction | "No springs, no bounce, 120/200/300ms tweens, no page transitions" | Add two spring presets, list and layout animation, a 120ms route fade, skeleton shimmer. Keep the "what does not animate" list. Add the **motion budget** (§8.2). |
| Components | 79 components | Add: `card`, `card-hover`, `project-card`, `note-card`, `focus-hero`, `progress-ring`, `checklist`, `empty-state-v2`, `ai-panel` (tinted), `landing-nav`, `landing-hero`, `product-frame`, `feature-row`, `faq-item`, `auth-split-panel`, `onboarding-step`. Update `nav-item`, `sidebar`, `top-bar`, `page-header`. |
| Screen recipes | Today, Tasks, Notes, Projects, Auth, … | Rewrite Today, Projects, Notes, Auth, Onboarding. Add **Landing** and **Empty states**. |
| Do's and Don'ts | Bans gradients, shadows on static content, springs, cards, AI marker | Replace the conflicting lines (§3.2). Keep the rest. |

### 3.2 Do's and Don'ts to replace

- Replace "Don't add … a gradient, a glow, glassmorphism or a drop shadow on anything that is not a floating layer" with: **Do** use the four shadow levels; **Don't** use glow, multi-color gradients, gradient text or gradient buttons. One soft single-hue wash is allowed behind the landing hero and the Today focus card.
- Replace "Don't wrap content in a card by default" with: **Do** use a card for one discrete object (project, note, focus, product frame); **Don't** nest cards or wrap a list of rows in a card.
- Replace "no bounce, springs…" with: springs only on things you touch or that enter (sheets, dialogs, list insert/remove/reorder); **Don't** bounce, overshoot, parallax or scroll-jack.
- Keep: no sparkle icons, no "AI" badge, one accent, color is never the only signal.
- Add: **Don't** put a red fill on more than one element per section; **Don't** animate more than two "feature" elements per screen.

### 3.3 Other documents to update in the same change

- **`specs/v1/03-ui-ux-spec.md`:** §1 design keywords; §3 layout (inset panel, collapsible sidebar); §13 AI (tinted panel); §16 empty states (add illustration); §20 motion (springs and list animation allowed within the budget). Product spec §13 "Avoid" list stays valid because it says *overuse*.
- **`CLAUDE.md`:** the Fonts row and the design-file notes (§2 and §4).
- **ADR `docs/decisions/0005-modern-calm-ui-direction.md`:** context, the decision (Option B), alternatives (A: polish only; C: full re-skin), consequences (DESIGN.md rewritten; mockups in `designs/` are stale until replaced).
- **`designs/`:** commission new mockups (Claude Design or Figma) for Today, Projects, Notes grid, Landing, Sign-in, Onboarding and Empty states, saved as `designs/v2/`. Agents build from the new mockups plus `DESIGN.md`. Until they exist, build from `DESIGN.md` and this document.
- **Lint gate:** `npx -y @google/design.md@latest lint --format json DESIGN.md` must report **0 errors and 0 warnings** (the same bar as the original file).
- **"Before" screenshots:** run the capture script (§11.1) once, before any code change, and keep the set outside the repo or under `docs/research/`.

---

## 4. Order of work

Each milestone leaves the app working and all tests passing.

| Milestone | Content | Sections |
| --- | --- | --- |
| M0 | Decisions, DESIGN.md, ADR, mockups, "before" screenshots | §3 |
| M1 | Foundation: tokens, shadows, radii, red rule, generator, contrast test | §5 |
| M2 | Layout and shell | §6 |
| M3 | Screens, **Today first** | §7 |
| M4 | Motion | §8 |
| M5 | AI inline restyle | §9.1–9.4 |
| M6 | Auth, onboarding, checklist, empty states, brand | §9.5–9.9 |
| M7 | Landing page | §10 |
| M8 | Quality gate | §11 |

M5 and M6 can swap order. Do not start M3 before M1 and M2 are done, or screens get restyled twice.

---

## 5. Foundation (M1)

### 5.1 A simpler color system

The current theme has ~43 hand-picked values per mode. Linear cut theirs from 98 variables to 3 (base, accent, contrast), computed in a perceptually uniform space. Do the same.

- **Inputs:** `base` (the paper hue and chroma), `accent` (ink blue, hue ≈ 248°), `contrast` (a level, so a high-contrast theme later is one change).
- **Generator:** `scripts/generate-theme.ts`. Pure OKLCH math (the same method used to build the original palette). It outputs the token block for `src/styles/globals.css` (light and dark) between marker comments, plus the values for `DESIGN.md`. Run with `pnpm theme:generate` (add the script).
- **Derived tokens:** background, raised, card, muted, hover, border, outline, foreground, muted-foreground, primary / strong / subtle, destructive, warning, success, sidebar, sidebar-accent, scrim, `ai-surface`, `ai-border`, `landing-wash`.
- **Kept as-is (not generated):** the eight project and tag colors, since they are named product tokens (`slate … pink`). Re-check them against the new surfaces.
- **Brand stays:** paper hue ≈ 85°, accent ≈ 248°, dark mode stays warm charcoal (never navy, never `#000`).
- **Contrast guarantee:** the generator refuses to emit a pair below 4.5:1 for text or 3:1 for UI boundaries, and a unit test re-checks every pair (§11.2).

### 5.2 Depth and shape

- **Shadow levels** (warm, sampled from the foreground color, top-down light, no x-offset). Define as CSS variables:
  - `--shadow-xs`: `0 1px 2px rgb(34 29 24 / 0.06)`. Static cards at rest.
  - `--shadow-sm`: `0 1px 3px rgb(34 29 24 / 0.08), 0 1px 2px rgb(34 29 24 / 0.05)`. Card hover, popovers.
  - `--shadow-md`: `0 4px 12px -2px rgb(34 29 24 / 0.10), 0 2px 4px rgb(34 29 24 / 0.05)`. Sheets, the product frame.
  - `--shadow-lg`: the existing floating shadow. Dialogs, command menu, toasts.
- **Dark mode:** shadows are invisible on dark, so each level becomes a 1px lighter border plus a faint 1px top highlight (`inset 0 1px 0 rgb(255 255 255 / 0.04)`). Higher still means lighter.
- **Radius scale:** `sm 4px` (chips, checkboxes, kbd), `md 8px` (buttons, inputs, nav items), `lg 12px` (cards, dialogs, popovers), `xl 16px` (landing product frame, large cards), `full` (avatars, dots, rings, todo checkboxes). Update `--radius-*` in `globals.css`.
- **Hover on cards:** border darkens one step and shadow goes `xs → sm`. **No translate or scale on hover** (it shifts layout, and the skill's rule is "stable hover states").
- **Z-index scale** (define once, use everywhere): `10` sidebar, `20` sticky header, `30` dropdowns and popovers, `40` sheet, `50` dialog, `60` toast, `70` command menu.

### 5.3 Red is rare

Today five red pills on one screen read as an alarm. New rule, enforced in the shared due-chip component:

- The **Overdue section header** carries the alarm: its count is in `destructive` text.
- **Rows** show overdue as `destructive`-colored **text with the clock icon and a relative label** ("5d late", "1d late", or the date after 14 days). **No filled pill** on rows.
- A filled `destructive-subtle` chip is allowed **at most once per section**: the single oldest overdue item.
- Add a pure helper `daysLate()` next to `src/lib/dates/relative.ts` and unit-test it.
- Color is still never the only signal: icon and text always accompany it.

### 5.4 Type

- Use Inter's `opsz` for `display`, `headline-*` and the landing `hero` role: tighter, more expressive headings at large sizes. Body stays regular Inter.
- Tracking and line-height rules from `DESIGN.md` stay. Today's greeting stays weight 600.
- Body text stays ≥16px on mobile inputs and 14px on dense desktop lists (unchanged).

### 5.5 Files

`src/styles/globals.css`, `scripts/generate-theme.ts`, `package.json` (`theme:generate`), `DESIGN.md` values, `src/components/tasks/due-chip.tsx`, `src/lib/dates/relative.ts`.

---

## 6. Layout and shell (M2)

### 6.1 Inset main panel and dimmer sidebar (desktop ≥ 1024px)

- The **sidebar sits on the ground color** (`--sidebar`, one step dimmer than today, with muted icons and text). The **main content is an inset panel**: `--background`, 12px radius on the top-left, 1px border, 8px gap from the window edge. Inside it, the content column scrolls; the sidebar does not. This is the Linear-style "inverted L": chrome is quiet, content stands out.
- Below 1024px the layout is unchanged (sidebar becomes a sheet, bottom nav on phones). No inset panel on touch layouts.

### 6.2 Sidebar

- Grouped, with the **same order** as product spec §5: *Plan* (Today, Inbox, Tasks), *Library* (Notes, Projects), then Search, Trash, Settings.
- Under **Projects**, list up to five active projects with their color dot, plus "All projects". The data is already in `WorkspaceProvider`; no new query.
- **Collapsible** to a 56px icon rail with a button and the shortcut `⌘\` (a new global shortcut, disabled while typing like the others). The state is stored in a **cookie** (`sidebar_collapsed`) so the server renders the right width and there is no layout jump on load. Tooltips (150ms) show the label on the rail.
- Account block at the bottom (avatar, name, theme toggle). Counts (Today, Inbox) use the crossfade from §8.
- Icons: 16px, 1.5px stroke, aligned on one baseline with the label.

### 6.3 Width

| Token | Value | Used by |
| --- | --- | --- |
| `--container-content` | 960px (was 880) | Tasks, Inbox, Search, Trash, Settings |
| `--container-wide` | 1200px (new) | Today, Projects grid, Notes grid |
| `--container-editor` | 760px (unchanged) | Note editor |

- The column is **centered** in the panel; text inside stays left-aligned.
- **Today at ≥ 1280px** is two columns: a main column (max 720px) and a right rail (320px). See §7.1.
- The task sheet (480px, resizable) docks to the right of the panel as today; when open, the column left-aligns so the list stays put.

### 6.4 Page header

One shared `PageHeader` (it exists) used by every page, in the same structure: title (`headline-lg`), a small meta line (count), right-aligned actions. It is **sticky** with an opaque `--background` (≥ 90% opacity) and a hairline that appears only after scrolling. Pages must stop hand-rolling their own headers.

### 6.5 Files

`src/components/layout/app-shell.tsx`, `sidebar-nav.tsx`, `nav-items.ts`, `top-bar.tsx`, `mobile-nav.tsx`, `page-header.tsx`, `app-shortcuts.tsx`, `src/app/(app)/layout.tsx` (read the cookie), `globals.css`.

---

## 7. Screens (M3)

Rebuild in this order and test after each one. Reuse the shared components (`TaskRow`, `TodoRow`, `NoteCard`, `EmptyState`, …); do not copy a variant into a page.

### 7.1 Today (first)

Layout, top to bottom (single column below 1280px, two columns at ≥ 1280px):

1. **Header:** greeting (`display`), the date (`body-lg`, muted), and on the right a **day-progress ring** ("3 of 7"). Progress = tasks and todos completed since the start of the person's day ÷ (those + open items due today). **Overdue is not counted**, so a backlog does not make the day feel lost. The ring animates only when the number changes, never on first paint.
2. **Capture** field (unchanged behavior), slightly taller, with the `C` shortcut hint.
3. **Focus hero** (the one big card). *Empty:* "Pick your focus" with up to **three suggested tasks** as one-click chips (top candidates from the already-loaded overdue and "needs planning" lists, no new query). *Set:* title (`headline-md`), due, project marker, subtask progress, and buttons **Mark done**, **Open**, **Change**. Subtle single-hue tint wash allowed here (§3.2).
4. **Daily brief:** the AI sentence plus **one action** ("Help me clean up"). Renders nothing when AI is off.
5. **Sections** as today (Overdue, Today, Todos, Needs planning, Completed today collapsed), but Overdue follows the red rule (§5.3) and is **collapsible**.
6. **Right rail (≥ 1280px; stacks below on smaller screens):** *Up next* (timed items later today), *Recent notes* (3 `NoteCard`s), *Inbox* (count and last two captures), and the **getting-started checklist** (§9.6) until it is dismissed or complete.

Empty day: the illustrated empty state (§9.7), not a grey box.

Files: `src/app/(app)/today/page.tsx`, `src/components/today/*` (new: `day-progress.tsx`, `focus-hero.tsx`, `today-rail.tsx`; update `focus-card.tsx`, `ai-suggestion-slot.tsx`, `today-lists.tsx`).

### 7.2 Tasks and Todos

- Keep the row layout and density. Add **hover/focus quick actions** on the right (due date, priority), revealed on hover and on keyboard focus, always visible on touch.
- Group headers: label-caps with a count; Overdue header per §5.3.
- **Completion moment** per §8.3. The segmented control and filter row get the new radius and spacing only.

### 7.3 Projects

- Replace thin rows with a **card grid** (1 column on phones, 2 at ≥ 768px, 3 at ≥ 1280px), grouped by status as today (Archived collapsed).
- `ProjectCard`: a 4px top strip in the project's `tag-*` color, name (`headline-sm`), up to two lines of description, a **progress ring or 6px bar** with a percentage (or "No items yet"), "3 open · 2 done", and the **next due task** as one line. The color is never the only identifier (the name is always shown).
- Cards use `shadow-xs`, and the hover rule from §5.2.

### 7.4 Notes

- Add a **list / grid toggle** (default list), stored in the URL (`?view=grid`) so it survives refresh and can be shared. Grid cards: emoji, title, a 3-line preview (the existing ~160-character `content_text` snippet), tags, project marker, relative time.
- The note editor page keeps its 760px reading column and gets only the new tokens, radius and toolbar polish.

### 7.5 Inbox, Search, Trash, Settings

- Same header, spacing and radius rules. Inbox: the capture box is more prominent; each item is a row with a quiet AI suggestion line (restyled in §9.1).
- Search page: grouped results with the type tabs; the command menu is restyled in §9.2.
- Trash and Settings: header and spacing only, plus empty states (§9.7). Settings keeps its top tabs (the design chose them; `DESIGN.md` will now say so).

### 7.6 Loading and errors

- `loading.tsx` for each route shows **skeleton rows and cards** shaped like the real content (reserve the space so nothing jumps). Shimmer is motion-safe only.
- `error.tsx` and `not-found.tsx` use the new components, with a clear action. No stack traces (unchanged rule).

---

## 8. Motion (M4)

### 8.1 Setup

- Install `motion` (already named in the technical spec's stack; pin the exact version). Wrap the app in a client `MotionProvider` (`src/components/motion/motion-provider.tsx`) rendering `<MotionConfig reducedMotion="user">`. With this setting Motion turns off **transform and layout** animation for people who ask for less motion, and keeps gentle opacity and color changes.
- **Motion tokens** in `src/lib/motion.ts` (the only place values live):
  - Durations: `fast 0.12`, `base 0.2`, `slow 0.3` (seconds). Nothing in the app UI runs longer than 0.5s.
  - Easing: `enter = [0.2, 0, 0, 1]`, `exit = [0.4, 0, 1, 1]` (match the existing CSS variables).
  - Springs: `snappy = { type: "spring", stiffness: 500, damping: 40, mass: 0.8 }` (things you touch); `gentle = { type: "spring", stiffness: 260, damping: 30 }` (sheets, panels).
- Keep the existing CSS variables and the global `prefers-reduced-motion` block in `globals.css` as a second safety net for CSS-only transitions.

### 8.2 The motion budget ("not too much")

- **At most two "feature" animations per screen** (the skill's rule: animate 1–2 key elements per view).
- **Only `transform` and `opacity`** for movement. Color, border and shadow may transition (150ms). Never animate width, height, top or left, except through Motion's `layout` (which uses transforms).
- **No infinite animation** except loading indicators, and those stop after 8 seconds or when the content arrives.
- **No** scroll-triggered reveals in the app, parallax, scroll-jacking, bounce, or overshoot.
- **Long lists:** turn off per-row `layout` animation when a list has more than **100** rows (use one helper so every list behaves the same).
- Hover never moves or scales an element.

### 8.3 What animates

| Interaction | Animation | Notes |
| --- | --- | --- |
| Task complete | Checkbox fills (120ms), tick path draws (150ms), title strikes through and dims (200ms) | The **row stays in place while the 5-second Undo toast is live** (existing rule). After the toast closes, the row leaves with a 200ms height collapse. Todo checkbox does the same, round. |
| List add | New row fades in and slides 4px (200ms); siblings move with `layout` (`snappy`) | |
| List remove / trash | Exit fade 160ms, siblings close the gap | Deletion stays non-optimistic. |
| Reorder | `layout` with `snappy` | Keyboard reorder unchanged. |
| Dialog | Opacity 0→1 and scale 0.98→1 (200ms, `enter`); exit 140ms | Scrim fades. |
| Task sheet | Slides in with `gentle`; resize is direct (no animation while dragging) | Expand and minimize use `gentle`. |
| Command menu | Opacity and scale 0.98→1, 160ms | |
| Route change | Main content **opacity only**, 120ms, via `src/app/(app)/template.tsx` | No slide. Replaces the old "navigation never animates" rule. |
| Counters (sidebar, headers) | Number crossfade 120ms | |
| Day-progress ring | Stroke animates 400ms **on change only** | Not on first paint. |
| Skeletons | Shimmer 1.4s, `motion-safe` | Static under reduced motion. |
| Toasts | Sonner defaults, restyled | |
| AI output | Streams as text; the panel grows with a 200ms `layout`; a blinking caret while generating | Caret does not blink under reduced motion. |
| Empty-state illustration | One-time stroke draw-in, 600ms, on mount only | Static under reduced motion. |

**Does not animate:** text the person is reading, autosave state changes (text swaps only), anything that would delay an action, hover position, scroll position.

### 8.4 Files

`package.json`, `src/lib/motion.ts`, `src/components/motion/*`, `src/app/layout.tsx` (provider), `src/app/(app)/template.tsx`, `src/components/tasks/task-row.tsx`, `todo-row.tsx`, `task-list.tsx`, `src/components/ui/dialog.tsx`, `sheet.tsx`, `src/components/command/command-menu.tsx`, `src/app/(app)/loading.tsx`.

---

## 9. Auth, onboarding, AI surfaces, empty states, brand (M5, M6)

### 9.1 AI inline (UI only)

Feature 05 already built every AI route and surface. This milestone only **restyles and reshapes** them. **No new routes, prompts, tables or limits.**

- **No chat sidebar and no chat page.** AI lives where the work is (Linear's "workbench" model).
- **Quiet identity (D2):** AI output uses `--ai-surface` (a faint tint of the accent over the card color) with a 1px `--ai-border` and the label "AI-generated". Buttons that start AI work stay ordinary ghost buttons with a verb ("Break into subtasks"). No sparkle, no badge, no gradient.
- **Previews feel like a diff:** each proposed item is a row with its own checkbox; **Accept all** and **Accept selected (N)** buttons; `Enter` confirms, `Esc` discards. Nothing is written before the confirm click (unchanged rule). Failed state keeps **Retry**.
- **Streaming** text renders progressively, with the caret (§8.3). The page never blocks (unchanged).
- Sources and "From your workspace" quotes keep their treatment, restyled with the new radius and border.

### 9.2 ⌘K and Ask

- Restyle the command menu per §5.2 (12px radius, `shadow-lg`, scrim) and §8.3.
- **Make Ask discoverable:** when AI is on and the query is a sentence (≥ 12 characters, or ends with `?`), add a last row **"Ask your workspace: '…'"**. `Enter` on it switches to the Ask tab and runs it. `Tab` still cycles the tabs. (Today there is no shortcut for Ask; this adds a visible path without a new global key.)
- Search results show emoji, title, project marker and a one-line snippet; the highlighted row uses `primary-subtle`.

### 9.3 Daily brief

Covered in §7.1 item 4. One sentence plus one action; hidden when AI is off or failing.

### 9.4 Settings → AI

Restyle only (usage meter, data notice) using the new tokens and header.

### 9.5 Sign-in and sign-up

- **Split layout at ≥ 1024px:** the form column (max 400px) on the left; on the right a calm panel with a **real product screenshot in a `product-frame`**, one line of value, and three short checkmarks. On phones: the form only.
- Social buttons first (Google, GitHub) with the **official brand marks as SVG** (take the official Simple Icons paths, do not guess), then an "or" divider, then email. Buttons are 44px tall on touch, show a spinner and are disabled while pending (existing behavior).
- Keep every error rule: inline field errors, `aria-live` form errors, no account enumeration.
- Brand wordmark and mark (D6) in the header. The auth pages are the one place a centered column remains.

### 9.6 Onboarding and the getting-started checklist

**Onboarding** (`/onboarding`): three short steps in the same route, with a progress indicator, Back, and a Skip that only skips optional steps:

1. **You:** name and time zone (pre-filled). Required, as today.
2. **Look:** theme as three **live preview cards** (Light, Dark, System), plus start-of-day.
3. **Start:** *Blank* or *Add sample data* (D5, optional). Continue goes to Today.

`Enter` advances. Reuse the existing `completeOnboarding` action; add the optional `sample` flag only if D5 is built.

**Getting-started checklist** (a compact card in Today's right rail, §7.1):

- Four items, **derived from real data** (no manual ticking): *Capture a thought* (any inbox item exists), *Add a task*, *Write a note*, *Link a note to a task*.
- A small data addition: `user_preferences.checklist_dismissed_at timestamptz NULL` (migration `0005`; additive, nullable, no backfill) and a `dismissChecklist` Server Action (`requireUser()`, no input). A pure function `deriveChecklist(counts)` returns the items and is unit-tested.
- When all four are done, the card shows a short completion state (checkmark draw, no confetti) and then hides itself. It can be dismissed any time.

**Optional sample data (D5):** one project ("Getting started"), four tasks, two todos and one note, all tagged **Sample** so they can be filtered and removed together by an action "Remove sample data" in Settings. Use the existing create functions inside one transaction; ownership rules unchanged. If time is short, skip it. Nothing else depends on it.

### 9.7 Empty states

A new `EmptyState` v2 (extend the existing component): a small **spot illustration**, a title (`headline-sm`), one sentence, one primary action, an optional secondary action, and an optional `kbd` hint.

- Illustrations are **in-house inline SVGs** (`src/components/illustrations/*.tsx`): single-color line art using `currentColor` plus the accent, ≤ 3 KB each, `aria-hidden`, 96–120px, readable in light and dark. **No emoji and no stock art.**
- Needed: `today-clear`, `tasks-empty`, `notes-empty`, `projects-empty`, `inbox-zero`, `trash-empty`, `search-empty`.
- Copy follows the spec's tone ("Your day is clear. Capture a task or start a note.") and never uses technical words.
- The draw-in animation plays once on mount (§8.3).

### 9.8 Brand, metadata and small things

- Brand mark SVG (D6) in `public/brand/`, used in the sidebar, auth, landing and favicon. Replace `src/app/icon.svg`; add `apple-icon`.
- `app/manifest.ts` (app metadata only; no service worker, PWA stays V2).
- Per-page `<title>` and description, an Open Graph image (`opengraph-image.tsx`), `sitemap.ts`, and an updated `robots` file (the app routes are disallowed; only the landing page and legal pages are indexed).
- Restyle the **email templates** in `src/lib/email/templates.ts` with the brand color and wordmark. Keep them system-font, table-based and plain-text-friendly, with no tracking pixels (unchanged rule).
- Restyle `not-found` and the error boundaries.

### 9.9 Files

`src/components/auth/*`, `src/app/(auth)/*`, `src/app/(onboarding)/*`, `src/actions/onboarding.ts`, `src/db/schema/preferences.ts` and migration `0005`, `src/lib/onboarding/checklist.ts`, `src/components/today/checklist.tsx`, `src/components/layout/empty-state.tsx`, `src/components/illustrations/*`, `src/components/ai/*`, `src/components/command/*`, `public/brand/*`, `src/lib/email/templates.ts`.

---

## 10. Landing page (M7)

### 10.1 What the competitors do (checked 2026-10-02)

Pages read: Notion, Jira, Linear, Todoist (summaries via a page reader, so layout details are second-hand).

| Pattern | Notion | Jira | Linear | Todoist |
| --- | --- | --- | --- | --- |
| Hero | Short promise + one-line explainer, two CTAs ("Get free" and a demo) | "Project management for the AI era", work-email sign-up in the hero | One sentence for "teams and agents", large product UI | "Clarity, finally." plus a user count |
| Visual | Stack of real product screenshots | Product video | Large real UI with a live-looking issue | Real dashboard and mobile screenshots |
| Social proof | Customer logos, three quotes, a metrics band | Logos, stats ("300,000+ companies"), quotes with photos | Three quotes, "40,000+ teams" | Review counts, press quotes, usage stats |
| Features | Three pillars (capture, find answers with citations, automate) | Features by theme, AI integrations | Four pillars shown with real UI | Four feature blocks, templates |
| AI | Answers **with citations** | Agents in the product | Agents and automations | An assistant video |
| Closing | Repeated CTA, big footer | Repeated CTA, big footer | Changelog preview, CTAs, big footer | Repeated CTA, templates, big footer |

**What is common:** a benefit-first headline; one primary CTA repeated; real product screenshots instead of illustrations; three or four feature pillars; AI shown as concrete behavior; proof; a closing CTA; a thorough footer.

**The ui-ux-pro-max skill's landing guidance** agrees: put the CTA above the fold, show social proof **before** the final CTA, and keep the section list short. Its generic palette suggestion (teal and orange, "flat design") was **not adopted**: it would discard Dayboard's brand. Its rules were adopted: floating nav with spacing from the edges, content padding under fixed bars, one consistent container width, `next/image` with dimensions, no emoji as icons, 44px targets, and reduced-motion respect.

### 10.2 What Dayboard must not do

- **No invented proof.** Dayboard has no customers, logos, ratings or user counts. **Do not add them, not even as placeholders that look real.** Use only claims that are true in the code today: private per-person data, AI that asks before it changes anything, AI that sends only the minimum context, account deletion, keyboard-first, and free to try only if the owner confirms.
- No fake "as seen in" strips, fake reviews, or stock testimonials.

### 10.3 Structure (route group `(marketing)`, route `/`)

1. **Floating nav** (`top-4` spacing): mark, Features, How it works, FAQ, Sign in, **Get started**. Sticky, ≥ 85% opaque background so it stays readable (the skill's rule: no `bg-white/10`).
2. **Hero:** benefit headline built from the product principle: **"Capture anything. Act on what matters."** One supporting sentence. Buttons: **Get started** (primary) and **See how it works** (scrolls to §3). Below: a **`product-frame`** with a real Today screenshot (light/dark swap with the theme), `xl` radius, `shadow-md`, `landing-wash` behind it.
3. **The loop:** *Capture → Organize → Execute → Review*, each with one small real UI crop (this is the spec's own loop).
4. **Four feature rows** (alternating sides, real screenshots, 2 lines and 3 bullets each): *Today and Focus*; *Tasks and Todos*; *Notes, projects and links*; *⌘K search and Ask, with sources*.
5. **AI that asks first:** a short, honest section on the preview-and-confirm behavior, with a static or one-animation mock of a preview dialog. Claims limited to what is true.
6. **Keyboard-first strip:** `⌘K`, `C`, `N`, `T` as `kbd` chips.
7. **Privacy and control:** your data is yours alone; delete your account any time; turn AI off any time.
8. **FAQ** (≤ 6 questions, accordion). Pricing question answers honestly per D4.
9. **Final CTA band** and **footer** (Product, Account, Legal). The footer links to **Privacy** and **Terms** pages. These need real text from the owner (open question Q4); until then they must not 404.

### 10.4 Build rules

- **Real screenshots only,** produced by a script (`scripts/capture-marketing.ts`, §11.1) from the seeded demo data in light and dark, saved as AVIF/WebP in `public/marketing/` with explicit `width` and `height`, served by `next/image`. Regenerate when the UI changes.
- **Static page.** `/` is statically rendered. Signed-in visitors are redirected to `/today` by the existing **cookie check in `src/proxy.ts`** (add `/` to that check; keep it optimistic only, as today). The root `page.tsx` renders the landing page instead of redirecting.
- **Mostly server components.** Client code only for the nav (mobile menu), the FAQ accordion and the theme switch.
- **Motion on this page:** at most two. The hero text and frame do a one-time staggered fade-up (400ms, 60ms apart); one feature mock may animate once when scrolled into view. No parallax, no scroll-jacking.
- **Performance targets** (Lighthouse, mobile, production build): Performance ≥ 90, Accessibility ≥ 95, SEO ≥ 95; LCP < 2.5s; no layout shift (reserve image space).
- **Accessibility:** one `h1`, a logical heading order, a skip link, visible focus, 4.5:1 contrast, alt text on every screenshot (describe what it shows), reduced-motion respected.

### 10.5 Files

`src/app/(marketing)/page.tsx` and `layout.tsx`, `src/components/marketing/*`, `src/proxy.ts`, `public/marketing/*`, `src/app/opengraph-image.tsx`, `src/app/sitemap.ts`, legal pages `src/app/(marketing)/privacy` and `terms`.

---

## 11. Tests and quality gate (M8)

### 11.1 Screenshot capture and baselines

- **`scripts/capture-screens.ts`:** signs in as the seeded demo user and captures the key screens. One script serves three jobs: the "before" and "after" sets, the marketing images (§10.4), and the visual baselines.
- **Visual E2E** (`e2e/visual.spec.ts`, Playwright `toHaveScreenshot`): the screens in §11.4 in light and dark at 360, 768 and 1440px, with deterministic seeded data, a fixed clock, `animations: "disabled"`, and masks for any dynamic text. Keep the baseline set small (≈ 40 images) and review diffs by eye; never update baselines blindly.

### 11.2 Contrast (automated)

- **Unit test** `tests/unit/theme-contrast.test.ts`: reads the generator output and asserts every foreground/background pair in both themes: **≥ 4.5:1** for text, **≥ 3:1** for control boundaries, focus rings and the eight tag colors against every surface they sit on. Fails the build on any regression.
- **Browser scan:** add `@axe-core/playwright` (dev dependency, test-only; justified under the dependency policy) and run the **color-contrast** rule and the general ruleset on every screen in light and dark (`e2e/a11y.spec.ts`). Zero serious or critical violations.

### 11.3 Reduced motion (automated)

- **Unit:** `MotionProvider` renders `reducedMotion="user"`.
- **E2E** (`e2e/reduced-motion.spec.ts`) with `page.emulateMedia({ reducedMotion: "reduce" })`: for task complete, list add, dialog open, sheet open and the route change, **sample the target element's computed `transform` every ~16ms for 300ms**; it must be `none` in every sample. Opacity and color changes are allowed. Also assert the shimmer and the caret blink are not running. Repeat once with motion allowed to prove the test can see movement (so it is not vacuous).

### 11.4 Responsive matrix and screens

Widths: **360, 390, 768, 1024, 1440** (and spot-check 1920). Screens: Today, Tasks, Todos, Projects, Notes (list and grid), a note, Inbox, Search, Trash, Settings, Sign-in, Sign-up, Onboarding (3 steps), Landing, an empty state of each type. No horizontal scroll at any width; tap targets ≥ 44px on touch; the bottom nav never covers content.

### 11.5 Existing tests

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e` and `pnpm build` must all pass. Restyling must not need test changes beyond updated visual baselines; if a selector breaks, fix the component to keep its accessible name, not the test.

### 11.6 Manual checklist (from the ui-ux-pro-max pre-delivery list)

- [ ] No emoji used as a UI icon (the user's own item emoji are content and stay)
- [ ] All icons from Lucide at one size and stroke; brand logos from official SVG
- [ ] `cursor-pointer` on every clickable card and row
- [ ] Hover states give feedback without shifting layout
- [ ] Transitions 150–300ms; focus rings visible on every interactive element
- [ ] Light and dark both checked; borders visible in both
- [ ] No content hidden behind the sticky header or bottom nav
- [ ] Forms: labels, inline errors, disabled-while-pending buttons
- [ ] `prefers-reduced-motion` honored everywhere

---

## 12. Definition of done

- [ ] **M0:** `DESIGN.md` rewritten and **lints with 0 errors and 0 warnings**; UI spec and `CLAUDE.md` updated; ADR 0005 written; "before" screenshots saved; owner has approved the decisions in §2.2.
- [ ] **M1:** one generator produces both themes; contrast unit test passes; four shadow levels and the new radii are live; red-is-rare enforced in the shared chip.
- [ ] **M2:** inset panel, dimmer sidebar (collapsible, cookie-persisted, project list), sticky shared page header, content centered at the new widths; phones and tablets unchanged in structure.
- [ ] **M3:** Today (progress ring, focus hero with suggestions, right rail, daily brief), Tasks quick actions, Projects card grid, Notes list/grid, and the other pages restyled; no screen hand-rolls its own header; skeletons match real content.
- [ ] **M4:** `motion` installed and pinned; `reducedMotion="user"` set; all interactions in §8.3 built within the §8.2 budget; the reduced-motion E2E passes; lists over 100 rows skip layout animation.
- [ ] **M5:** AI surfaces use the tinted panel; previews are accept/reject with keyboard; Ask is discoverable from search; **no chat sidebar, no sparkle, no new AI routes**; "never write without a confirm click" still holds (existing E2E passes).
- [ ] **M6:** split sign-in/sign-up with official brand marks; 3-step onboarding; derived checklist with dismiss (migration `0005`, unit test); illustrated empty states for all seven screens; brand mark, favicon, manifest, email templates restyled.
- [ ] **M7:** landing page live at `/` for signed-out visitors, signed-in visitors redirected; **no fabricated proof anywhere**; real screenshots via the script; Lighthouse targets met; Privacy and Terms pages exist.
- [ ] **M8:** visual baselines, axe scan, contrast unit test, reduced-motion E2E, responsive matrix and manual checklist all pass; "after" screenshots saved.
- [ ] No server contract changed (apart from §9.6); information density unchanged; all earlier tests green.
- [ ] `agent_docs/ui-modernization_v1.md` written (see `CLAUDE.md` §6), including every deviation from this document.

---

## 13. Dependencies and migrations

| Item | Detail |
| --- | --- |
| `motion` | Runtime. Already in the approved stack; pin the exact version. |
| `@axe-core/playwright` | Dev only, for the accessibility scan. |
| Fonts | No new packages. `@fontsource-variable/inter` is already installed; check its `opsz` file for D1. |
| Migration `0005` | `user_preferences.checklist_dismissed_at timestamptz NULL`. Additive, no backfill. |
| Scripts | `theme:generate`, `capture:screens`, `capture:marketing` (names may be refined). |
| Not added | No second component library, no Tailwind plugin set, no 3D or scroll libraries. Copy-paste snippets from Magic UI or Motion Primitives need an ADR first and are not expected here. |

---

## 14. Out of scope (V1)

- **Pricing, plans, billing and paywalls.** Product spec §3 lists billing as a non-goal. The landing page has no pricing section; add one in V3 with the billing work.
- New AI behavior, a chat interface, "rewrite selection" in the editor, AI weekly review.
- Teams, sharing, notifications, a calendar view.
- A service worker or offline mode (V2). The manifest is metadata only.
- Customer logos, testimonials, ratings or usage numbers (there is nothing true to show yet).
- Marketing extras: blog, changelog page, docs site, localisation.
- Replacing `designs/` v1 files. New mockups go in `designs/v2/`.

---

## 15. Open questions for the owner

Answer in Milestone 0. Defaults in brackets.

1. Option B confirmed? [yes]
2. Heading font: Inter with `opsz` [yes], Inter plus a serif for the landing hero only, or the serif back everywhere?
3. Sample data in onboarding (D5)? [skip for now]
4. Legal text for Privacy and Terms: who supplies it? [owner; a short plain-language draft that the owner reviews]
5. Free to try? The landing page can say "free" only if that is true. [no pricing claim]
6. Brand mark: commission with Claude Design or Figma? [Claude Design, then export the SVG]
7. Should the landing page replace the sign-in page as the front door for signed-out visitors? [yes, with a clear Sign in link]

---

## 16. As built (2026-10-03)

Built on the defaults in §2.2 and §15 (owner sign-off still open). Every deviation, with its reason, is in `agent_docs/ui-modernization_v1.md`. In short:

- **Not built:** the `designs/v2/` mockups (built from `DESIGN.md` and this document instead); sample data in onboarding (D5, skipped by default).
- **Kept on purpose:** AI preview buttons keep their verbs ("Create 3 tasks") with Select all/none and Enter/Esc; the focus card's checkbox is its "Mark done"; Today's rail keeps the heading "Recently updated notes"; popovers share the dialog layer (50) so pickers inside dialogs stay on top.
- **Narrowed:** the sidebar shows "Show all (N)" only past five projects; row quick actions are hidden below 768px.
- **Data:** read-only additions only: exact progress counts and the newest inbox items in the Today loader, `nextDueTasks()`, `checklistCounts()`; plus migration `0005` and `dismissChecklist` (§9.6).
- **Tests:** visual baselines are a time-independent set of 48 (macOS); the reduced-motion test samples `transform`, `scale` and `translate` and asserts they never change; four existing E2E files needed small edits (listed in the hand-off).
